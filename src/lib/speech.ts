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

const MAX_AZURE_WAV_BYTES = 64 * 1024 * 1024;
const MIN_SPEECH_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_SPEECH_TIMEOUT_MS = 46 * 60 * 1000;
const SPEECH_TIMEOUT_PADDING_MS = 60 * 1000;

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

export async function assessPronunciation(
  request: SpeechAssessRequest,
  abortSignal?: AbortSignal,
) {
  if (!isTauriRuntimeAvailable()) {
    throw createAppError(
      "AZURE_DESKTOP_REQUIRED",
      "Azure 语音评估需要在 Tauri 桌面端运行。",
    );
  }

  if (!Number.isFinite(request.durationMs) || request.durationMs <= 0) {
    throw createAppError(
      "AZURE_DURATION_INVALID",
      "语音评估需要有效的 WAV 时长。",
    );
  }

  const timeoutMs = calculateSpeechAssessmentTimeoutMs(request.durationMs);
  const cancellation = createAssessmentCancellation(abortSignal, timeoutMs);
  let recognizer: SpeechSdk.SpeechRecognizer | null = null;
  let audioConfig: SpeechSdk.AudioConfig | null = null;

  try {
    const azureSpeechToken = await raceWithAbort(
      invokeCommand<AzureSpeechToken>("issue_azure_speech_token"),
      cancellation.signal,
    );
    const wavBytes = await readWavBytesWithLimit(
      request.wavPath,
      cancellation.signal,
    );
    const speechConfig = SpeechSdk.SpeechConfig.fromAuthorizationToken(
      azureSpeechToken.token,
      azureSpeechToken.region,
    );
    speechConfig.speechRecognitionLanguage = azureSpeechToken.language;
    speechConfig.outputFormat = SpeechSdk.OutputFormat.Detailed;

    audioConfig = SpeechSdk.AudioConfig.fromWavFileInput(
      new File([wavBytes.buffer as ArrayBuffer], "assessment.wav"),
    );
    recognizer = new SpeechSdk.SpeechRecognizer(speechConfig, audioConfig);
    const pronunciationAssessmentConfig = createPronunciationAssessmentConfig(
      request.referenceText,
      azureSpeechToken.language,
    );
    pronunciationAssessmentConfig.applyTo(recognizer);

    const assessmentResult = await runContinuousPronunciationAssessment(
      recognizer,
      cancellation.signal,
    );
    const cancellationError = cancellation.getError();
    if (cancellationError) {
      throw cancellationError;
    }
    return assessmentResult;
  } catch (error) {
    const cancellationError = cancellation.getError();
    if (cancellationError) {
      throw cancellationError;
    }
    throw error;
  } finally {
    cancellation.dispose();
    if (recognizer) {
      recognizer.close();
    } else {
      audioConfig?.close();
    }
  }
}

export function calculateSpeechAssessmentTimeoutMs(durationMs: number) {
  const requestedTimeoutMs = durationMs * 1.5 + SPEECH_TIMEOUT_PADDING_MS;
  return Math.min(
    MAX_SPEECH_TIMEOUT_MS,
    Math.max(MIN_SPEECH_TIMEOUT_MS, requestedTimeoutMs),
  );
}

export function mapAzureSpeechResultJson(
  rawJson: string,
): SpeechAssessmentResult {
  let parsed: AzureSpeechResultJson;
  try {
    parsed = JSON.parse(rawJson) as AzureSpeechResultJson;
  } catch {
    throw createAppError(
      "AZURE_SPEECH_JSON_INVALID",
      "Azure 语音评估响应无法解析。",
    );
  }

  return mapAzureSpeechResult(parsed);
}

function createPronunciationAssessmentConfig(
  referenceText: string | undefined,
  language: string,
) {
  const assessmentConfig = new SpeechSdk.PronunciationAssessmentConfig(
    referenceText?.trim() || "",
    SpeechSdk.PronunciationAssessmentGradingSystem.HundredMark,
    SpeechSdk.PronunciationAssessmentGranularity.Phoneme,
    false,
  );
  assessmentConfig.enableProsodyAssessment = language.toLowerCase() === "en-us";

  return assessmentConfig;
}

export async function readWavBytesWithLimit(
  wavPath: string,
  abortSignal: AbortSignal,
) {
  const assetUrl = convertFileSrc(wavPath);
  const response = await fetch(assetUrl, { signal: abortSignal });
  if (!response.ok) {
    throw createAppError(
      "AZURE_WAV_READ_FAILED",
      "无法读取转码后的 WAV 文件。",
      response.status,
    );
  }

  return readResponseBodyWithLimit(response, MAX_AZURE_WAV_BYTES);
}

export async function readResponseBodyWithLimit(
  response: Response,
  maximumBytes: number,
) {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader
    ? Number(contentLengthHeader)
    : undefined;
  if (
    contentLength !== undefined &&
    Number.isFinite(contentLength) &&
    contentLength > maximumBytes
  ) {
    await response.body?.cancel();
    throw createAppError(
      "AZURE_WAV_TOO_LARGE",
      "WAV 文件超过 64 MiB 评估限制。",
    );
  }
  if (!response.body) {
    throw createAppError(
      "AZURE_WAV_STREAM_UNAVAILABLE",
      "无法以流式方式读取转码后的 WAV 文件。",
    );
  }

  const streamReader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await streamReader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await streamReader.cancel();
        throw createAppError(
          "AZURE_WAV_TOO_LARGE",
          "WAV 文件超过 64 MiB 评估限制。",
        );
      }
      chunks.push(value);
    }
  } finally {
    streamReader.releaseLock();
  }

  const wavBytes = new Uint8Array(totalBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    wavBytes.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return wavBytes;
}

export function runContinuousPronunciationAssessment(
  recognizer: SpeechSdk.SpeechRecognizer,
  abortSignal: AbortSignal,
) {
  if (abortSignal.aborted) {
    return Promise.reject(
      createAppError("AZURE_SPEECH_CANCELED", "Azure 语音评估已取消。"),
    );
  }

  return new Promise<SpeechAssessmentResult>((resolve, reject) => {
    const recognizedResults: SpeechAssessmentResult[] = [];
    let settled = false;
    let stopRequested = false;
    let requestedStopError: AppError | null = null;
    let stopFallbackTimeoutId: number | null = null;

    const cleanup = () => {
      abortSignal.removeEventListener("abort", handleAbort);
      if (stopFallbackTimeoutId !== null) {
        window.clearTimeout(stopFallbackTimeoutId);
        stopFallbackTimeoutId = null;
      }
    };

    function rejectImmediately(error: AppError) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    }

    function rejectAfterStopping(error: AppError) {
      if (settled || stopRequested) {
        return;
      }
      stopRequested = true;
      requestedStopError = error;
      stopFallbackTimeoutId = window.setTimeout(
        () => rejectImmediately(error),
        5_000,
      );
      try {
        recognizer.stopContinuousRecognitionAsync(
          () => rejectImmediately(error),
          () => rejectImmediately(error),
        );
      } catch {
        rejectImmediately(error);
      }
    }

    function handleAbort() {
      rejectAfterStopping(
        createAppError("AZURE_SPEECH_CANCELED", "Azure 语音评估已取消。"),
      );
    }

    abortSignal.addEventListener("abort", handleAbort, { once: true });

    recognizer.recognized = (_sender, event) => {
      if (event.result.reason !== SpeechSdk.ResultReason.RecognizedSpeech) {
        return;
      }

      const rawJson = event.result.properties.getProperty(
        SpeechSdk.PropertyId.SpeechServiceResponse_JsonResult,
      );
      if (!rawJson) {
        return;
      }

      try {
        const result = mapAzureSpeechResultJson(rawJson);
        if (result.words.length > 0 || result.recognizedText) {
          recognizedResults.push(result);
        }
      } catch (error) {
        rejectAfterStopping(
          isAppErrorLike(error)
            ? error
            : createAppError(
                "AZURE_SPEECH_RESULT_INVALID",
                "Azure 语音评估结果无效。",
              ),
        );
      }
    };

    recognizer.canceled = () => {
      rejectAfterStopping(
        createAppError(
          "AZURE_SPEECH_SERVICE_CANCELED",
          "Azure 语音评估被服务取消，请检查网络、凭据、region 或音频格式。",
        ),
      );
    };

    recognizer.sessionStopped = () => {
      if (settled || stopRequested) {
        return;
      }

      settled = true;
      cleanup();
      const mergedResult = mergeSpeechAssessmentResults(recognizedResults);
      if (!mergedResult.words.length && !mergedResult.recognizedText) {
        reject(
          createAppError(
            "AZURE_SPEECH_EMPTY_RESULT",
            "Azure 语音评估未返回可用 transcript。",
          ),
        );
        return;
      }

      resolve(mergedResult);
    };

    recognizer.startContinuousRecognitionAsync(
      () => undefined,
      () =>
        rejectImmediately(
          requestedStopError ??
            createAppError(
              "AZURE_SPEECH_START_FAILED",
              "Azure 语音评估启动失败。",
            ),
        ),
    );
  });
}

function createAssessmentCancellation(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let cancellationError: AppError | null = null;

  function cancel(error: AppError) {
    if (controller.signal.aborted) {
      return;
    }
    cancellationError = error;
    controller.abort();
  }

  const handleExternalAbort = () =>
    cancel(createAppError("AZURE_SPEECH_CANCELED", "Azure 语音评估已取消。"));
  if (externalSignal?.aborted) {
    handleExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", handleExternalAbort, {
      once: true,
    });
  }

  const timeoutId = window.setTimeout(() => {
    cancel(
      createAppError("AZURE_SPEECH_TIMED_OUT", "Azure 语音评估超过总时限。"),
    );
  }, timeoutMs);

  return {
    signal: controller.signal,
    getError: () => cancellationError,
    dispose: () => {
      window.clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    },
  };
}

function raceWithAbort<T>(promise: Promise<T>, abortSignal: AbortSignal) {
  if (abortSignal.aborted) {
    return Promise.reject(
      createAppError("AZURE_SPEECH_CANCELED", "Azure 语音评估已取消。"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(createAppError("AZURE_SPEECH_CANCELED", "Azure 语音评估已取消。"));
    };
    abortSignal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function mapAzureSpeechResult(
  parsed: AzureSpeechResultJson,
): SpeechAssessmentResult {
  const bestResult = parsed.NBest?.[0];
  const words = (bestResult?.Words ?? [])
    .map(mapAzureWord)
    .filter((word) => word.word.trim());
  const recognizedText = (
    bestResult?.Display ??
    parsed.DisplayText ??
    bestResult?.Lexical ??
    ""
  ).trim();

  return {
    overall: mapAzureOverall(bestResult?.PronunciationAssessment),
    words,
    durationMs: ticksToMs(parsed.Duration ?? 0),
    recognizedText,
  };
}

function mapAzureOverall(
  value: AzurePronunciationAssessmentJson | undefined,
): SpeechAssessmentOverall {
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

function mergeSpeechAssessmentResults(
  results: SpeechAssessmentResult[],
): SpeechAssessmentResult {
  const allWords = results.flatMap((result) => result.words);
  const recognizedText = results
    .map((result) => result.recognizedText)
    .filter(Boolean)
    .join(" ")
    .trim();
  const durationMs = allWords.reduce(
    (latestEndMs, word) =>
      Math.max(latestEndMs, word.startMs + word.durationMs),
    0,
  );

  return {
    overall: averageOverallScores(results),
    words: allWords,
    durationMs,
    recognizedText,
  };
}

function averageOverallScores(
  results: SpeechAssessmentResult[],
): SpeechAssessmentOverall {
  return {
    accuracyScore: averageDefinedScore(
      results.map((result) => result.overall.accuracyScore),
    ),
    fluencyScore: averageDefinedScore(
      results.map((result) => result.overall.fluencyScore),
    ),
    completenessScore: averageDefinedScore(
      results.map((result) => result.overall.completenessScore),
    ),
    prosodyScore: averageDefinedScore(
      results.map((result) => result.overall.prosodyScore),
    ),
    pronunciationScore: averageDefinedScore(
      results.map((result) => result.overall.pronunciationScore),
    ),
  };
}

function averageDefinedScore(scores: Array<number | undefined>) {
  const definedScores = scores.filter(
    (score): score is number => score !== undefined,
  );
  if (!definedScores.length) {
    return undefined;
  }

  return Number(
    (
      definedScores.reduce((sum, score) => sum + score, 0) /
      definedScores.length
    ).toFixed(1),
  );
}

function ticksToMs(ticks: number) {
  return Math.round(ticks / 10_000);
}

function createAppError(
  code: string,
  message: string,
  status?: number,
): AppError & Error {
  return Object.assign(new Error(message), { code, status });
}

function isAppErrorLike(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as AppError).code === "string" &&
    typeof (value as AppError).message === "string"
  );
}
