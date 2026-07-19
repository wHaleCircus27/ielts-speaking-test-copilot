import { useEffect, useRef, useState } from "react";
import {
  buildTeacherCaseSearchQuery,
  mapTeacherCaseMatchesToRagExamples,
  mapTeacherCaseMatchesToRagReferences,
  searchTeacherCases,
} from "../lib/corpus";
import { gradeSpeaking } from "../lib/grading";
import {
  cancelMediaTranscode,
  deleteGeneratedMediaFile,
  getMediaMetadata,
  selectMediaFile,
  transcodeMedia,
} from "../lib/media";
import { assessPronunciation, validateAzureConfig } from "../lib/speech";
import { getTranscriptText } from "../lib/transcript";
import type { PublicAppConfig } from "../types/config";
import type { AppError } from "../types/errors";
import type {
  GradeResult,
  RagPromptExample,
  SpeakingPart,
} from "../types/grading";
import type {
  MediaMetadata,
  MediaProcessingPhase,
  MediaTranscodeResult,
} from "../types/media";
import type { SpeechAssessmentResult } from "../types/speech";
import type {
  AddCorrectionRecordInput,
  InputMode,
  RagUsageInfo,
} from "../app/workspaceTypes";
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
  onAddRecord: (input: AddCorrectionRecordInput) => unknown;
  onClearPendingMedia: () => void;
  resetPlaybackState: () => void;
}) {
  const [inputMode, setInputMode] = useState<InputMode>("media");
  const [mediaPath, setMediaPath] = useState("");
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(
    null,
  );
  const [mediaTranscodeResult, setMediaTranscodeResult] =
    useState<MediaTranscodeResult | null>(null);
  const [speechAssessmentResult, setSpeechAssessmentResult] =
    useState<SpeechAssessmentResult | null>(null);
  const [mediaPhase, setMediaPhase] = useState<MediaProcessingPhase>("idle");
  const [mediaPreviewOnly, setMediaPreviewOnly] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<AppError | null>(null);
  const [dragging, setDragging] = useState(false);
  const activeOperationIdRef = useRef(0);
  const activeTranscodeJobIdRef = useRef<string | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (pendingMediaPath) {
      void loadMediaPath(pendingMediaPath);
    }
    // A new import is triggered only by a new pending path; loadMediaPath guards late async results with operation refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMediaPath]);

  useEffect(() => {
    return () => {
      activeOperationIdRef.current += 1;
      speechAbortControllerRef.current?.abort();
      const activeJobId = activeTranscodeJobIdRef.current;
      if (activeJobId) {
        void cancelMediaTranscode(activeJobId);
      }
    };
  }, []);

  const mediaBusy = mediaPhase !== "idle";
  const cloudDisclosureAccepted =
    config.disclosure.acceptedVersion === config.disclosure.latestVersion;
  const azureWorkflowReady =
    config.azure.enabled &&
    config.azure.credentialStatus === "configured" &&
    cloudDisclosureAccepted;
  const canStartMediaCorrection =
    Boolean(mediaPath.trim()) &&
    Boolean(mediaMetadata?.supported) &&
    azureWorkflowReady &&
    !mediaBusy &&
    !mediaPreviewOnly;

  async function chooseMediaFileFromDialog(
    browserFileInput: HTMLInputElement | null,
  ) {
    await cancelMediaWorkflow(false);
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
      setMediaError(normalizeMediaWorkflowError(error));
    }
  }

  async function loadMediaPath(nextMediaPath: string) {
    await cancelMediaWorkflow(false);
    const operationId = ++activeOperationIdRef.current;
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

    setMediaPhase("inspecting");
    setMediaError(null);
    try {
      const nextMetadata = await getMediaMetadata(normalizedMediaPath);
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setMediaMetadata(nextMetadata);
      if (!nextMetadata.supported) {
        setMediaError({
          code: "MEDIA_UNSUPPORTED_TYPE",
          message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
        });
      }
    } catch (error) {
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setMediaMetadata(null);
      setMediaNotice(null);
      setMediaError(normalizeMediaWorkflowError(error));
    } finally {
      if (operationId === activeOperationIdRef.current) {
        setMediaPhase("idle");
      }
    }
  }

  async function startMediaAiCorrection() {
    const normalizedMediaPath = mediaPath.trim();
    if (!normalizedMediaPath || !mediaMetadata?.supported) {
      return;
    }
    if (!azureWorkflowReady) {
      setMediaError({
        code: "AZURE_SERVICE_NOT_READY",
        message: "请先启用 Azure Speech、配置匹配的凭据并接受云服务数据说明。",
      });
      return;
    }

    const operationId = ++activeOperationIdRef.current;
    const transcodeJobId = createMediaJobId();
    const speechAbortController = new AbortController();
    activeTranscodeJobIdRef.current = transcodeJobId;
    speechAbortControllerRef.current = speechAbortController;
    let generatedOutputPath: string | null = null;
    let historyPersisted = false;

    setMediaPhase("transcoding");
    setMediaNotice(null);
    setMediaError(null);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    resetPlaybackState();
    try {
      const nextResult = await transcodeMedia({
        jobId: transcodeJobId,
        inputPath: normalizedMediaPath,
      });
      generatedOutputPath = nextResult.outputPath;
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        throw createMediaCancellationError();
      }
      activeTranscodeJobIdRef.current = null;
      setMediaTranscodeResult(nextResult);
      const refreshedMetadata = await getMediaMetadata(normalizedMediaPath);
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        throw createMediaCancellationError();
      }
      setMediaMetadata(refreshedMetadata);
      setMediaNotice(
        "音视频已转码为标准 WAV，正在提交 Azure 进行长音频发音评估。",
      );
      setMediaPhase("assessing");
      const azureConfigValidationResult = await validateAzureConfig();
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        throw createMediaCancellationError();
      }
      if (!azureConfigValidationResult.ok) {
        throw {
          code: "AZURE_CONFIG_INVALID",
          message: azureConfigValidationResult.message,
        } satisfies AppError;
      }

      const nextSpeechAssessmentResult = await assessPronunciation(
        {
          wavPath: nextResult.outputPath,
          durationMs: nextResult.durationMs,
        },
        speechAbortController.signal,
      );
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        throw createMediaCancellationError();
      }
      setMediaPhase("grading");
      const transcriptText =
        getTranscriptText(nextSpeechAssessmentResult) ||
        nextSpeechAssessmentResult.recognizedText;
      const transcriptGradingResult = await gradeTranscriptWithDeepSeek({
        transcriptText,
        question,
        part,
      });
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        throw createMediaCancellationError();
      }
      setSpeechAssessmentResult(nextSpeechAssessmentResult);
      const workspaceResult = mapSpeechAssessmentToWorkspaceResult(
        nextSpeechAssessmentResult,
        transcriptGradingResult?.gradeResult ?? null,
        transcriptGradingResult?.ragUsage,
      );
      await onAddRecord({
        title:
          customTitle.trim() ||
          question.trim() ||
          getFileNameFromPath(normalizedMediaPath).replace(/\.[^/.]+$/, ""),
        fileName:
          mediaMetadata?.fileName ?? getFileNameFromPath(normalizedMediaPath),
        result: workspaceResult,
        audioPath: nextResult.outputPath,
      });
      historyPersisted = true;
      setMediaNotice(
        transcriptGradingResult?.gradeResult
          ? "Azure 长音频发音评估完成，DeepSeek 已基于 transcript 补充词汇、语法和话题内容。"
          : "Azure 长音频发音评估完成；DeepSeek 文本维度暂不可用，已保留 transcript 和发音报告。",
      );
    } catch (error) {
      if (generatedOutputPath && !historyPersisted) {
        await deleteGeneratedMediaFile(generatedOutputPath).catch(() => false);
      }
      if (operationId !== activeOperationIdRef.current) {
        return;
      }

      setMediaTranscodeResult(null);
      setSpeechAssessmentResult(null);
      if (
        isMediaCancellationError(error) ||
        speechAbortController.signal.aborted
      ) {
        setMediaNotice("媒体处理已取消。");
        setMediaError(null);
      } else {
        setMediaNotice(null);
        setMediaError(normalizeMediaWorkflowError(error));
      }
    } finally {
      if (operationId === activeOperationIdRef.current) {
        activeTranscodeJobIdRef.current = null;
        speechAbortControllerRef.current = null;
        setMediaPhase("idle");
      }
    }
  }

  async function cancelMediaWorkflow(showNotice = true) {
    const activeJobId = activeTranscodeJobIdRef.current;
    const hasActiveSpeechAssessment = Boolean(speechAbortControllerRef.current);
    if (!activeJobId && !hasActiveSpeechAssessment) {
      return;
    }

    activeOperationIdRef.current += 1;
    setMediaPhase("canceling");
    speechAbortControllerRef.current?.abort();
    activeTranscodeJobIdRef.current = null;
    speechAbortControllerRef.current = null;
    if (activeJobId) {
      await cancelMediaTranscode(activeJobId).catch(() => ({
        jobId: activeJobId,
        canceled: false,
      }));
    }
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaError(null);
    setMediaNotice(showNotice ? "媒体处理已取消。" : null);
    setMediaPhase("idle");
  }

  async function gradeTranscriptWithDeepSeek(input: {
    transcriptText: string;
    question: string;
    part: SpeakingPart;
  }): Promise<{ gradeResult: GradeResult; ragUsage: RagUsageInfo } | null> {
    const normalizedTranscript = input.transcriptText.trim();
    if (
      !serviceReady ||
      !config.deepseek.enabled ||
      config.deepseek.credentialStatus !== "configured" ||
      !cloudDisclosureAccepted ||
      normalizedTranscript.length < 20
    ) {
      return null;
    }

    try {
      const { ragExamples, ragUsage } = await loadRagContextForTranscript(
        input.question,
        normalizedTranscript,
      );
      const gradeResult = await gradeSpeaking({
        text: normalizedTranscript,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples,
      });
      return { gradeResult, ragUsage };
    } catch {
      return null;
    }
  }

  async function loadRagContextForTranscript(
    transcriptQuestion: string,
    transcriptText: string,
  ): Promise<{ ragExamples: RagPromptExample[]; ragUsage: RagUsageInfo }> {
    if (
      !config.zhipu.enabled ||
      config.zhipu.credentialStatus !== "configured" ||
      !cloudDisclosureAccepted
    ) {
      return {
        ragExamples: [],
        ragUsage: {
          status: "notConfigured",
          message: "未配置智谱 API Key，本次评分未使用教师案例库。",
          references: [],
        },
      };
    }

    try {
      const matches = await searchTeacherCases(
        buildTeacherCaseSearchQuery(transcriptQuestion, transcriptText),
        3,
      );
      return {
        ragExamples: mapTeacherCaseMatchesToRagExamples(matches),
        ragUsage: {
          status: matches.length ? "matched" : "none",
          message: matches.length
            ? `已引用 ${matches.length} 条教师案例。`
            : "案例库没有达到相似度阈值的匹配项。",
          references: mapTeacherCaseMatchesToRagReferences(matches),
        },
      };
    } catch {
      return {
        ragExamples: [],
        ragUsage: {
          status: "failed",
          message: "教师案例检索失败，本次评分未使用案例库。",
          references: [],
        },
      };
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
    void cancelMediaWorkflow(false);
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
    setMediaPhase("idle");
    resetPlaybackState();

    if (supported) {
      setMediaError(null);
      setMediaNotice(
        "网页预览已读取文件信息；真实 afconvert 转码需要在 Tauri 桌面端运行。",
      );
    } else {
      setMediaNotice(null);
      setMediaError({
        code: "MEDIA_UNSUPPORTED_TYPE",
        message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
      });
    }
  }

  function clearSelectedMedia() {
    void cancelMediaWorkflow(false);
    activeOperationIdRef.current += 1;
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
    mediaPhase,
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
    cancelMediaWorkflow,
    handleDroppedFile,
    loadBrowserPreviewFile,
    clearSelectedMedia,
  };
}

function createMediaJobId() {
  return globalThis.crypto.randomUUID();
}

function createMediaCancellationError(): AppError {
  return {
    code: "MEDIA_CANCELED",
    message: "媒体处理已取消。",
  };
}

function isMediaCancellationError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "MEDIA_CANCELED" ||
      (error as { code?: unknown }).code === "AZURE_SPEECH_CANCELED")
  );
}

function normalizeMediaWorkflowError(error: unknown): AppError {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return error as AppError;
  }

  return {
    code: "MEDIA_WORKFLOW_FAILED",
    message: "媒体批改未完成，所选文件仍保留，可修复问题后重试。",
  };
}
