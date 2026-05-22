import { convertFileSrc } from "@tauri-apps/api/core";
import * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import { invokeCommand } from "./tauri";
import type { AppError } from "../types/errors";
import type {
  AzureConfigValidationResult,
  AzureSpeechToken,
  SpeechAssessmentOverall,
  SpeechAssessmentResult,
  SpeechAssessRequest,
  SpeechWordAssessment,
} from "../types/speech";

type AzurePronunciationAssessmentJson = {
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  ProsodyScore?: number;
  PronScore?: number;
};

type AzureWordJson = {
  Word?: string;
  Offset?: number;
  Duration?: number;
  PronunciationAssessment?: {
    AccuracyScore?: number;
    ErrorType?: string;
  };
  Phonemes?: Array<{
    Phoneme?: string;
    PronunciationAssessment?: {
      AccuracyScore?: number;
    };
  }>;
};

type AzureBestResultJson = {
  Display?: string;
  Lexical?: string;
  PronunciationAssessment?: AzurePronunciationAssessmentJson;
  Words?: AzureWordJson[];
};

type AzureSpeechResultJson = {
  DisplayText?: string;
  Duration?: number;
  NBest?: AzureBestResultJson[];
};

function isTauriRuntimeAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function validateAzureConfig() {
  if (!isTauriRuntimeAvailable()) {
    return Promise.resolve<AzureConfigValidationResult>({
      ok: false,
      keyConfigured: false,
      region: "",
      language: "en-US",
      message: "Azure Speech 配置校验需要在 Tauri 桌面端运行。",
    });
  }

  return invokeCommand<AzureConfigValidationResult>("validate_azure_config");
}

export async function assessPronunciation(request: SpeechAssessRequest) {
  if (!isTauriRuntimeAvailable()) {
    throw createAppError("AZURE_DESKTOP_REQUIRED", "Azure 语音评估需要在 Tauri 桌面端运行。");
  }

  const azureSpeechToken = await invokeCommand<AzureSpeechToken>("issue_azure_speech_token");
  const wavBytes = await readWavBytes(request.wavPath);
  const speechConfig = SpeechSdk.SpeechConfig.fromAuthorizationToken(
    azureSpeechToken.token,
    azureSpeechToken.region,
  );
  speechConfig.speechRecognitionLanguage = azureSpeechToken.language;
  speechConfig.outputFormat = SpeechSdk.OutputFormat.Detailed;

  const audioConfig = SpeechSdk.AudioConfig.fromWavFileInput(new File([wavBytes], "assessment.wav"));
  const recognizer = new SpeechSdk.SpeechRecognizer(speechConfig, audioConfig);
  const pronunciationAssessmentConfig = createPronunciationAssessmentConfig(
    request.referenceText,
    azureSpeechToken.language,
  );
  pronunciationAssessmentConfig.applyTo(recognizer);

  try {
    return await runContinuousPronunciationAssessment(recognizer);
  } finally {
    recognizer.close();
  }
}

export function mapAzureSpeechResultJson(rawJson: string): SpeechAssessmentResult {
  let parsed: AzureSpeechResultJson;
  try {
    parsed = JSON.parse(rawJson) as AzureSpeechResultJson;
  } catch (error) {
    throw createAppError(
      "AZURE_SPEECH_JSON_INVALID",
      "Azure 语音评估响应无法解析。",
      error instanceof Error ? error.message : undefined,
    );
  }

  return mapAzureSpeechResult(parsed);
}

function createPronunciationAssessmentConfig(referenceText: string | undefined, language: string) {
  const assessmentConfig = new SpeechSdk.PronunciationAssessmentConfig(
    referenceText?.trim() || "",
    SpeechSdk.PronunciationAssessmentGradingSystem.HundredMark,
    SpeechSdk.PronunciationAssessmentGranularity.Phoneme,
    false,
  );
  assessmentConfig.enableProsodyAssessment = language.toLowerCase() === "en-us";

  return assessmentConfig;
}

async function readWavBytes(wavPath: string) {
  const assetUrl = convertFileSrc(wavPath);
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw createAppError(
      "AZURE_WAV_READ_FAILED",
      `无法读取转码后的 WAV 文件，状态 ${response.status}。`,
    );
  }

  return await response.arrayBuffer();
}

function runContinuousPronunciationAssessment(recognizer: SpeechSdk.SpeechRecognizer) {
  return new Promise<SpeechAssessmentResult>((resolve, reject) => {
    const recognizedResults: SpeechAssessmentResult[] = [];
    let settled = false;

    recognizer.recognized = (_sender, event) => {
      if (event.result.reason !== SpeechSdk.ResultReason.RecognizedSpeech) {
        return;
      }

      const rawJson = event.result.properties.getProperty(SpeechSdk.PropertyId.SpeechServiceResponse_JsonResult);
      if (!rawJson) {
        return;
      }

      try {
        const result = mapAzureSpeechResultJson(rawJson);
        if (result.words.length > 0 || result.recognizedText) {
          recognizedResults.push(result);
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    };

    recognizer.canceled = (_sender, event) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(
        createAppError(
          "AZURE_SPEECH_CANCELED",
          event.errorDetails || "Azure 语音评估已取消，请检查网络、Key、region 或音频格式。",
        ),
      );
    };

    recognizer.sessionStopped = () => {
      if (settled) {
        return;
      }

      settled = true;
      const mergedResult = mergeSpeechAssessmentResults(recognizedResults);
      if (!mergedResult.words.length && !mergedResult.recognizedText) {
        reject(createAppError("AZURE_SPEECH_EMPTY_RESULT", "Azure 语音评估未返回可用 transcript。"));
        return;
      }

      resolve(mergedResult);
    };

    recognizer.startContinuousRecognitionAsync(
      () => undefined,
      (error) => {
        if (!settled) {
          settled = true;
          reject(createAppError("AZURE_SPEECH_START_FAILED", "Azure 语音评估启动失败。", String(error)));
        }
      },
    );
  });
}

function mapAzureSpeechResult(parsed: AzureSpeechResultJson): SpeechAssessmentResult {
  const bestResult = parsed.NBest?.[0];
  const words = (bestResult?.Words ?? []).map(mapAzureWord).filter((word) => word.word.trim());
  const recognizedText = (bestResult?.Display ?? parsed.DisplayText ?? bestResult?.Lexical ?? "").trim();

  return {
    overall: mapAzureOverall(bestResult?.PronunciationAssessment),
    words,
    durationMs: ticksToMs(parsed.Duration ?? 0),
    recognizedText,
  };
}

function mapAzureOverall(value: AzurePronunciationAssessmentJson | undefined): SpeechAssessmentOverall {
  if (!value) {
    return {};
  }

  return {
    accuracyScore: value.AccuracyScore,
    fluencyScore: value.FluencyScore,
    completenessScore: value.CompletenessScore,
    prosodyScore: value.ProsodyScore,
    pronunciationScore: value.PronScore,
  };
}

function mapAzureWord(word: AzureWordJson): SpeechWordAssessment {
  return {
    word: word.Word ?? "",
    startMs: ticksToMs(word.Offset ?? 0),
    durationMs: ticksToMs(word.Duration ?? 0),
    accuracyScore: word.PronunciationAssessment?.AccuracyScore,
    errorType: word.PronunciationAssessment?.ErrorType,
    phonemes: word.Phonemes?.map((phoneme) => ({
      phoneme: phoneme.Phoneme ?? "",
      accuracyScore: phoneme.PronunciationAssessment?.AccuracyScore,
    })).filter((phoneme) => phoneme.phoneme.trim()),
  };
}

function mergeSpeechAssessmentResults(results: SpeechAssessmentResult[]): SpeechAssessmentResult {
  const allWords = results.flatMap((result) => result.words);
  const recognizedText = results.map((result) => result.recognizedText).filter(Boolean).join(" ").trim();
  const durationMs = allWords.reduce(
    (latestEndMs, word) => Math.max(latestEndMs, word.startMs + word.durationMs),
    0,
  );

  return {
    overall: averageOverallScores(results),
    words: allWords,
    durationMs,
    recognizedText,
  };
}

function averageOverallScores(results: SpeechAssessmentResult[]): SpeechAssessmentOverall {
  return {
    accuracyScore: averageDefinedScore(results.map((result) => result.overall.accuracyScore)),
    fluencyScore: averageDefinedScore(results.map((result) => result.overall.fluencyScore)),
    completenessScore: averageDefinedScore(results.map((result) => result.overall.completenessScore)),
    prosodyScore: averageDefinedScore(results.map((result) => result.overall.prosodyScore)),
    pronunciationScore: averageDefinedScore(results.map((result) => result.overall.pronunciationScore)),
  };
}

function averageDefinedScore(scores: Array<number | undefined>) {
  const definedScores = scores.filter((score): score is number => score !== undefined);
  if (!definedScores.length) {
    return undefined;
  }

  return Number((definedScores.reduce((sum, score) => sum + score, 0) / definedScores.length).toFixed(1));
}

function ticksToMs(ticks: number) {
  return Math.round(ticks / 10_000);
}

function createAppError(code: string, message: string, detail?: string): AppError {
  return { code, message, detail };
}
