import {
  FileAudio,
  FileVideo,
  Loader2,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import type { PublicAppConfig } from "../../types/config";
import type { AppError } from "../../types/errors";
import type { SpeakingPart } from "../../types/grading";
import type {
  MediaMetadata,
  MediaProcessingPhase,
  MediaTranscodeResult,
} from "../../types/media";
import type { SpeechAssessmentResult } from "../../types/speech";
import type { InputMode } from "../../app/workspaceTypes";
import {
  formatBytes,
  formatOptionalScore,
  getFileNameFromPath,
  isVideoPath,
} from "../../app/workspaceUtils";

export function WorkspaceInput({
  config,
  inputMode,
  customTitle,
  question,
  part,
  textInput,
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
  answerLength,
  canSubmitText,
  canStartMediaCorrection,
  isLoading,
  serviceReady,
  cardClass,
  accentClass,
  secondaryClass,
  browserFileInputRef,
  onSetInputMode,
  onSetCustomTitle,
  onSetQuestion,
  onSetPart,
  onSetTextInput,
  onSetDragging,
  onChooseMediaFile,
  onHandleDroppedFile,
  onLoadBrowserPreviewFile,
  onClearSelectedMedia,
  onCancelMedia,
  onSubmitCorrection,
}: {
  config: PublicAppConfig;
  inputMode: InputMode;
  customTitle: string;
  question: string;
  part: SpeakingPart;
  textInput: string;
  mediaPath: string;
  mediaMetadata: MediaMetadata | null;
  mediaTranscodeResult: MediaTranscodeResult | null;
  speechAssessmentResult: SpeechAssessmentResult | null;
  mediaPhase: MediaProcessingPhase;
  mediaBusy: boolean;
  mediaPreviewOnly: boolean;
  mediaNotice: string | null;
  mediaError: AppError | null;
  dragging: boolean;
  answerLength: number;
  canSubmitText: boolean;
  canStartMediaCorrection: boolean;
  isLoading: boolean;
  serviceReady: boolean;
  cardClass: string;
  accentClass: string;
  secondaryClass: string;
  browserFileInputRef: React.RefObject<HTMLInputElement>;
  onSetInputMode: (inputMode: InputMode) => void;
  onSetCustomTitle: (customTitle: string) => void;
  onSetQuestion: (question: string) => void;
  onSetPart: (part: SpeakingPart) => void;
  onSetTextInput: (textInput: string) => void;
  onSetDragging: (dragging: boolean) => void;
  onChooseMediaFile: () => void;
  onHandleDroppedFile: (file: File) => void;
  onLoadBrowserPreviewFile: (file: File) => void;
  onClearSelectedMedia: () => void;
  onCancelMedia: () => void;
  onSubmitCorrection: () => void;
}) {
  const mediaCancelable =
    mediaPhase === "transcoding" || mediaPhase === "assessing";

  return (
    <div className="flex flex-col space-y-4 min-[1180px]:col-span-5 min-[1180px]:min-h-0">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-1 text-xs font-bold uppercase tracking-tight opacity-70">
          <span>作业导入与文本批改</span>
        </h3>
        <div className="flex rounded-lg bg-current/5 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => onSetInputMode("media")}
            disabled={mediaBusy || isLoading}
            className={`rounded-md px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${inputMode === "media" ? accentClass : "opacity-60 hover:opacity-100"}`}
          >
            音视频录传
          </button>
          <button
            type="button"
            onClick={() => onSetInputMode("text")}
            disabled={mediaBusy || isLoading}
            className={`rounded-md px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${inputMode === "text" ? accentClass : "opacity-60 hover:opacity-100"}`}
          >
            手工手写文本
          </button>
        </div>
      </div>

      <div
        className={`${cardClass} relative flex min-h-[340px] flex-col justify-between space-y-4 p-4 min-[1180px]:flex-1`}
      >
        {dragging ? (
          <div className="absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-500/10 backdrop-blur-sm">
            <div className="space-y-1 text-center">
              <Upload size={36} className="mx-auto text-indigo-500" />
              <p className="text-sm font-bold">释放文件导入到工作区</p>
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60">
            作业标题 (可选)
          </label>
          <input
            type="text"
            placeholder="例如: Part 2 科技对生活的影响"
            value={customTitle}
            onChange={(event) => onSetCustomTitle(event.target.value)}
            className="workspace-input"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)]">
          <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wider opacity-70">
            考试部分
            <select
              value={part}
              onChange={(event) =>
                onSetPart(event.target.value as SpeakingPart)
              }
              className="workspace-input text-xs font-normal normal-case"
            >
              <option value="part1">Part 1</option>
              <option value="part2">Part 2</option>
              <option value="part3">Part 3</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wider opacity-70">
            题目
            <input
              value={question}
              onChange={(event) => onSetQuestion(event.target.value)}
              placeholder="例如: Describe a memorable trip"
              className="workspace-input text-xs font-normal normal-case"
            />
          </label>
        </div>

        <div className="flex flex-1 flex-col justify-center py-2">
          {inputMode === "media" ? (
            <div className="flex flex-col space-y-4">
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  onSetDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  onSetDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onSetDragging(false);
                  const file = event.dataTransfer.files.item(0);
                  if (file) {
                    onHandleDroppedFile(file);
                  }
                }}
                className="workspace-file-dropzone flex flex-col items-center justify-center space-y-2 rounded-xl border-2 border-dashed border-current/20 bg-current/[0.01] p-6 text-center transition hover:border-current/40"
              >
                {mediaPath ? (
                  <div className="flex w-full max-w-md flex-col items-center gap-4">
                    <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-left">
                      <div className="flex min-w-0 items-center gap-3">
                        {isVideoPath(mediaMetadata?.fileName ?? mediaPath) ? (
                          <FileVideo
                            size={22}
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <FileAudio
                            size={22}
                            className="shrink-0 text-emerald-500"
                          />
                        )}
                        <div className="min-w-0 leading-tight">
                          <p className="truncate text-sm font-bold text-emerald-600">
                            {mediaMetadata?.fileName ??
                              getFileNameFromPath(mediaPath)}
                          </p>
                          <p className="mt-1 text-[10px] opacity-60">
                            {mediaMetadata
                              ? `${formatBytes(mediaMetadata.sizeBytes)} / ${mediaMetadata.supported ? "格式可转码" : "格式不支持"}`
                              : mediaBusy
                                ? "正在读取文件信息"
                                : "等待检查文件信息"}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onClearSelectedMedia}
                        className="shrink-0 rounded bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-200"
                      >
                        清空
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={onChooseMediaFile}
                      disabled={mediaBusy}
                      className={`rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${secondaryClass}`}
                    >
                      更换文件
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload size={28} className="opacity-60" />
                    <div>
                      <p className="text-xs font-semibold">
                        拖拽音频或视频文件至此处
                      </p>
                      <p className="mt-1 text-[10px] opacity-50">
                        支持 MP4, MP3, M4A, WAV；转码为 16kHz 16bit mono PCM
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onChooseMediaFile}
                      disabled={mediaBusy}
                      className={`rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${secondaryClass}`}
                    >
                      手动浏览文件
                    </button>
                  </>
                )}
                <input
                  ref={browserFileInputRef}
                  type="file"
                  accept=".mp4,.mp3,.m4a,.wav,audio/mp4,audio/mpeg,audio/wav,video/mp4"
                  className="hidden"
                  onChange={(event) => {
                    const selectedFile =
                      event.target.files?.item?.(0) ?? event.target.files?.[0];
                    if (selectedFile) {
                      onLoadBrowserPreviewFile(selectedFile);
                    }
                    event.currentTarget.value = "";
                  }}
                />
              </div>

              {mediaTranscodeResult ? (
                <div className="space-y-2 rounded-lg border border-current/10 bg-current/[0.02] p-3 text-[10px] leading-4">
                  <div className="font-bold text-emerald-600">转码完成</div>
                  <div className="break-all opacity-70">
                    输出路径：{mediaTranscodeResult.outputPath}
                  </div>
                  <div className="opacity-70">
                    格式：WAV / {mediaTranscodeResult.sampleRate} Hz /{" "}
                    {mediaTranscodeResult.channels} channel /{" "}
                    {mediaTranscodeResult.codec}
                  </div>
                </div>
              ) : null}

              {speechAssessmentResult ? (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-[10px] leading-4 text-emerald-700">
                  <div className="font-bold">Azure 语音评估完成</div>
                  <div className="mt-1 opacity-80">
                    Pronunciation{" "}
                    {formatOptionalScore(
                      speechAssessmentResult.overall.pronunciationScore,
                    )}{" "}
                    / Accuracy{" "}
                    {formatOptionalScore(
                      speechAssessmentResult.overall.accuracyScore,
                    )}
                  </div>
                </div>
              ) : null}

              {mediaNotice ? (
                <div className="rounded-lg border border-current/10 bg-current/[0.04] p-2.5 text-[10px] font-semibold leading-4 opacity-70">
                  {mediaNotice}
                </div>
              ) : null}

              {mediaError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[10px] font-semibold leading-4 text-red-600">
                  {mediaError.message}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full flex-col space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60">
                写入您的雅思答题脚本
              </label>
              <textarea
                placeholder="复制粘贴或手写录入您的答题原稿内容..."
                value={textInput}
                onChange={(event) => onSetTextInput(event.target.value)}
                className="workspace-textarea"
              />
              <span className="text-[10px] opacity-50">
                当前长度：{answerLength} 字符；至少 20 字符后可提交。
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-current/10 pt-3">
          <button
            type="button"
            onClick={onSubmitCorrection}
            disabled={
              inputMode === "text"
                ? isLoading || !canSubmitText
                : mediaBusy || !canStartMediaCorrection
            }
            className={`flex w-full items-center justify-center gap-1.5 rounded py-2.5 text-xs font-bold shadow-md transition disabled:opacity-50 ${accentClass}`}
          >
            {inputMode === "media" && mediaBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : inputMode === "media" ? (
              <FileAudio size={14} />
            ) : (
              <Sparkles size={14} className={isLoading ? "animate-spin" : ""} />
            )}
            <span>
              {inputMode === "media"
                ? mediaBusy
                  ? mediaPhase === "assessing"
                    ? "Azure 发音评估中..."
                    : mediaPhase === "grading"
                      ? "生成批改报告中..."
                      : mediaPhase === "inspecting"
                        ? "检查媒体中..."
                        : mediaPhase === "canceling"
                          ? "取消中..."
                          : "转码中..."
                  : "开始 AI 作业批改"
                : isLoading
                  ? "考官 AI 精审分析中..."
                  : "开始 DeepSeek 文本批改"}
            </span>
          </button>
          {mediaCancelable ? (
            <button
              type="button"
              onClick={onCancelMedia}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded py-2 text-xs font-bold ${secondaryClass}`}
            >
              <XCircle size={14} />
              取消
            </button>
          ) : null}
          {inputMode === "text" && !canSubmitText ? (
            <p className="mt-2 text-[10px] leading-4 opacity-55">
              {!serviceReady
                ? "本地服务未连接。"
                : mediaBusy
                  ? "请先完成或取消当前媒体任务。"
                  : config.disclosure.acceptedVersion !==
                      config.disclosure.latestVersion
                    ? "请先在设置中接受云服务数据说明。"
                    : !config.deepseek.enabled
                      ? "请先在设置中启用 DeepSeek。"
                      : config.deepseek.credentialStatus !== "configured"
                        ? "请先配置与当前 endpoint 匹配的 DeepSeek Key。"
                        : "请输入至少 20 字符。"}
            </p>
          ) : null}
          {inputMode === "media" && !canStartMediaCorrection ? (
            <p className="mt-2 text-[10px] leading-4 opacity-55">
              {!mediaPath
                ? isLoading
                  ? "请先等待当前文本批改完成。"
                  : "请先选择或拖入 MP4、MP3、M4A、WAV 文件。"
                : isLoading
                  ? "请先等待当前文本批改完成。"
                  : mediaPreviewOnly
                    ? "网页预览只能读取文件信息；真实转码请使用 Tauri 桌面端。"
                    : mediaMetadata && !mediaMetadata.supported
                      ? "当前格式不支持转码。"
                      : !config.azure.enabled
                        ? "请先在设置中启用 Azure Speech。"
                        : config.azure.credentialStatus !== "configured"
                          ? "请先配置与当前 region 匹配的 Azure 凭据。"
                          : config.disclosure.acceptedVersion !==
                              config.disclosure.latestVersion
                            ? "请先接受云服务数据说明。"
                            : "请等待文件检查完成。"}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
