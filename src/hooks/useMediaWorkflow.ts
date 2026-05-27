import { useEffect, useState } from "react";
import { mapTeacherCaseMatchesToRagExamples, searchTeacherCases } from "../lib/corpus";
import { gradeSpeaking } from "../lib/grading";
import { getMediaMetadata, selectMediaFile, transcodeMedia } from "../lib/media";
import { assessPronunciation, validateAzureConfig } from "../lib/speech";
import { getTranscriptText } from "../lib/transcript";
import type { PublicAppConfig } from "../types/config";
import type { AppError } from "../types/errors";
import type { GradeResult, SpeakingPart } from "../types/grading";
import type { MediaMetadata, MediaTranscodeResult } from "../types/media";
import type { SpeechAssessmentResult } from "../types/speech";
import type { InputMode, WorkspaceResult } from "../app/workspaceTypes";
import {
  getFileExtension,
  getFileNameFromPath,
  getLocalFilePath,
  isSupportedMediaExtension,
  isTauriRuntimeAvailable,
  mapSpeechAssessmentToWorkspaceResult,
} from "../app/workspaceUtils";

export function useMediaWorkflow({
  config,
  serviceReady,
  pendingMediaPath,
  question,
  part,
  customTitle,
  onAddRecord,
  onClearPendingMedia,
  resetPlaybackState,
}: {
  config: PublicAppConfig;
  serviceReady: boolean;
  pendingMediaPath: string;
  question: string;
  part: SpeakingPart;
  customTitle: string;
  onAddRecord: (title: string, fileName: string, result: WorkspaceResult) => void;
  onClearPendingMedia: () => void;
  resetPlaybackState: () => void;
}) {
  const [inputMode, setInputMode] = useState<InputMode>("media");
  const [mediaPath, setMediaPath] = useState("");
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(null);
  const [mediaTranscodeResult, setMediaTranscodeResult] = useState<MediaTranscodeResult | null>(null);
  const [speechAssessmentResult, setSpeechAssessmentResult] = useState<SpeechAssessmentResult | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaPreviewOnly, setMediaPreviewOnly] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<AppError | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (pendingMediaPath) {
      void loadMediaPath(pendingMediaPath);
    }
  }, [pendingMediaPath]);

  const canStartMediaCorrection =
    Boolean(mediaPath.trim()) && Boolean(mediaMetadata?.supported) && !mediaBusy && !mediaPreviewOnly;

  async function chooseMediaFileFromDialog(browserFileInput: HTMLInputElement | null) {
    setInputMode("media");
    setMediaError(null);
    setMediaNotice(null);
    if (!isTauriRuntimeAvailable()) {
      browserFileInput?.click();
      return;
    }

    try {
      const selectedPath = await selectMediaFile();
      if (selectedPath) {
        await loadMediaPath(selectedPath);
      }
    } catch (error) {
      setMediaError(error as AppError);
    }
  }

  async function loadMediaPath(nextMediaPath: string) {
    const normalizedMediaPath = nextMediaPath.trim();
    setInputMode("media");
    setMediaPath(normalizedMediaPath);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(false);
    setMediaNotice(null);
    resetPlaybackState();

    if (!normalizedMediaPath) {
      setMediaMetadata(null);
      setMediaNotice(null);
      setMediaError({
        code: "MEDIA_PATH_EMPTY",
        message: "请先选择或拖入一个媒体文件。",
      });
      return;
    }

    setMediaBusy(true);
    setMediaError(null);
    try {
      const nextMetadata = await getMediaMetadata(normalizedMediaPath);
      setMediaMetadata(nextMetadata);
      if (!nextMetadata.supported) {
        setMediaError({
          code: "MEDIA_UNSUPPORTED_TYPE",
          message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
        });
      }
    } catch (error) {
      setMediaMetadata(null);
      setMediaNotice(null);
      setMediaError(error as AppError);
    } finally {
      setMediaBusy(false);
    }
  }

  async function startMediaAiCorrection() {
    const normalizedMediaPath = mediaPath.trim();
    if (!normalizedMediaPath || !mediaMetadata?.supported) {
      return;
    }

    setMediaBusy(true);
    setMediaNotice(null);
    setMediaError(null);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    resetPlaybackState();
    try {
      const nextResult = await transcodeMedia({ inputPath: normalizedMediaPath });
      setMediaTranscodeResult(nextResult);
      setMediaMetadata(await getMediaMetadata(normalizedMediaPath));
      setMediaNotice("音视频已转码为标准 WAV，正在提交 Azure 进行长音频发音评估。");
      const azureConfigValidationResult = await validateAzureConfig();
      if (!azureConfigValidationResult.ok) {
        setMediaNotice(null);
        setMediaError({
          code: "AZURE_CONFIG_INVALID",
          message: azureConfigValidationResult.message,
        });
        return;
      }

      const nextSpeechAssessmentResult = await assessPronunciation({
        wavPath: nextResult.outputPath,
      });
      const transcriptText = getTranscriptText(nextSpeechAssessmentResult) || nextSpeechAssessmentResult.recognizedText;
      const transcriptGradeResult = await gradeTranscriptWithDeepSeek({
        transcriptText,
        question,
        part,
      });
      setSpeechAssessmentResult(nextSpeechAssessmentResult);
      const workspaceResult = mapSpeechAssessmentToWorkspaceResult(nextSpeechAssessmentResult, transcriptGradeResult);
      onAddRecord(
        customTitle.trim() || question.trim() || getFileNameFromPath(normalizedMediaPath).replace(/\.[^/.]+$/, ""),
        mediaMetadata?.fileName ?? getFileNameFromPath(normalizedMediaPath),
        workspaceResult,
      );
      setMediaNotice(
        transcriptGradeResult
          ? "Azure 长音频发音评估完成，DeepSeek 已基于 transcript 补充词汇、语法和话题内容。"
          : "Azure 长音频发音评估完成；DeepSeek 文本维度暂不可用，已保留 transcript 和发音报告。",
      );
    } catch (error) {
      setMediaError(error as AppError);
    } finally {
      setMediaBusy(false);
    }
  }

  async function gradeTranscriptWithDeepSeek(input: {
    transcriptText: string;
    question: string;
    part: SpeakingPart;
  }): Promise<GradeResult | null> {
    const normalizedTranscript = input.transcriptText.trim();
    if (!serviceReady || !config.deepseek.apiKeyConfigured || normalizedTranscript.length < 20) {
      return null;
    }

    try {
      const ragExamples = config.zhipu.apiKeyConfigured
        ? mapTeacherCaseMatchesToRagExamples(await searchTeacherCases(normalizedTranscript, 3))
        : [];
      return await gradeSpeaking({
        text: normalizedTranscript,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples,
      });
    } catch {
      return null;
    }
  }

  function handleDroppedFile(file: File) {
    const droppedPath = getLocalFilePath(file);
    if (!droppedPath) {
      if (!isTauriRuntimeAvailable()) {
        loadBrowserPreviewFile(file);
      } else {
        setMediaNotice(null);
        setMediaError({
          code: "MEDIA_DROP_PATH_UNAVAILABLE",
          message: "无法从拖拽文件读取本地路径，请使用“手动浏览文件”按钮。",
        });
      }
      return;
    }

    void loadMediaPath(droppedPath);
  }

  function loadBrowserPreviewFile(file: File) {
    const extension = getFileExtension(file.name);
    const supported = isSupportedMediaExtension(extension);
    setInputMode("media");
    setMediaPath(file.name);
    setMediaMetadata({
      path: file.name,
      fileName: file.name,
      extension,
      sizeBytes: file.size,
      supported,
    });
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(true);
    setMediaBusy(false);
    resetPlaybackState();

    if (supported) {
      setMediaError(null);
      setMediaNotice("网页预览已读取文件信息；真实 FFmpeg 转码需要在 Tauri 桌面端运行。");
    } else {
      setMediaNotice(null);
      setMediaError({
        code: "MEDIA_UNSUPPORTED_TYPE",
        message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
      });
    }
  }

  function clearSelectedMedia() {
    setMediaPath("");
    setMediaMetadata(null);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(false);
    setMediaNotice(null);
    setMediaError(null);
    resetPlaybackState();
    onClearPendingMedia();
  }

  return {
    inputMode,
    mediaPath,
    mediaMetadata,
    mediaTranscodeResult,
    speechAssessmentResult,
    mediaBusy,
    mediaPreviewOnly,
    mediaNotice,
    mediaError,
    dragging,
    canStartMediaCorrection,
    setInputMode,
    setDragging,
    chooseMediaFileFromDialog,
    startMediaAiCorrection,
    handleDroppedFile,
    loadBrowserPreviewFile,
    clearSelectedMedia,
  };
}
