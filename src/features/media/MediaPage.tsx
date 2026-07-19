import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  FolderOpen,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/Field";
import {
  cancelMediaTranscode,
  getMediaMetadata,
  selectMediaFile,
  transcodeMedia,
} from "../../lib/media";
import { assessPronunciation, validateAzureConfig } from "../../lib/speech";
import {
  buildTranscriptTokens,
  lowAccuracyThreshold,
} from "../../lib/transcript";
import type { AppError } from "../../types/errors";
import type {
  MediaMetadata,
  MediaProcessingPhase,
  MediaTranscodeResult,
} from "../../types/media";
import type {
  SpeechAssessmentResult,
  TranscriptToken,
} from "../../types/speech";

const supportedExtensions = "MP4, MP3, M4A, WAV";

export function MediaPage() {
  const [inputPath, setInputPath] = useState("");
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [result, setResult] = useState<MediaTranscodeResult | null>(null);
  const [speechAssessmentResult, setSpeechAssessmentResult] =
    useState<SpeechAssessmentResult | null>(null);
  const [phase, setPhase] = useState<MediaProcessingPhase>("idle");
  const [error, setError] = useState<AppError | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const activeOperationIdRef = useRef(0);
  const activeTranscodeJobIdRef = useRef<string | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);
  const busy = phase !== "idle";
  const outputUrl = useMemo(
    () => (result ? pathToAssetUrl(result.outputPath) : null),
    [result],
  );
  const transcriptTokens = useMemo(
    () =>
      speechAssessmentResult
        ? buildTranscriptTokens(speechAssessmentResult.words)
        : [],
    [speechAssessmentResult],
  );

  useEffect(() => {
    let disposed = false;
    let removeDragDropListener: (() => void) | null = null;

    async function registerDragDropListener() {
      try {
        removeDragDropListener = await getCurrentWebview().onDragDropEvent(
          (event) => {
            if (event.payload.type !== "drop") {
              return;
            }

            const droppedPath = event.payload.paths[0] ?? "";
            if (!droppedPath) {
              setError({
                code: "MEDIA_DROP_PATH_UNAVAILABLE",
                message: "无法从拖拽文件读取本地路径，请使用“选择文件”按钮。",
              });
              return;
            }

            setInputPath(droppedPath);
            void loadMetadata(droppedPath);
          },
        );

        if (disposed) {
          removeDragDropListener();
        }
      } catch {
        removeDragDropListener = null;
      }
    }

    void registerDragDropListener();

    return () => {
      disposed = true;
      removeDragDropListener?.();
      activeOperationIdRef.current += 1;
      speechAbortControllerRef.current?.abort();
      const activeJobId = activeTranscodeJobIdRef.current;
      if (activeJobId) {
        void cancelMediaTranscode(activeJobId);
      }
    };
    // The window listener is installed once; dropped paths are passed explicitly and async state is guarded by refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function chooseFile() {
    setError(null);
    const selected = await selectMediaFile();
    if (!selected) {
      return;
    }

    setInputPath(selected);
    await loadMetadata(selected);
  }

  async function loadMetadata(path = inputPath) {
    await cancelActiveOperation();
    if (!path.trim()) {
      setMetadata(null);
      setResult(null);
      setSpeechAssessmentResult(null);
      return;
    }

    const operationId = ++activeOperationIdRef.current;
    setPhase("inspecting");
    setError(null);
    setResult(null);
    setSpeechAssessmentResult(null);
    try {
      const nextMetadata = await getMediaMetadata(path);
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setMetadata(nextMetadata);
    } catch (caught) {
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setMetadata(null);
      setError(caught as AppError);
    } finally {
      if (operationId === activeOperationIdRef.current) {
        setPhase("idle");
      }
    }
  }

  async function startTranscode() {
    if (!inputPath.trim()) {
      return;
    }

    const operationId = ++activeOperationIdRef.current;
    const jobId = globalThis.crypto.randomUUID();
    activeTranscodeJobIdRef.current = jobId;
    setPhase("transcoding");
    setError(null);
    setResult(null);
    setSpeechAssessmentResult(null);
    try {
      const nextResult = await transcodeMedia({ inputPath, jobId });
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      activeTranscodeJobIdRef.current = null;
      setResult(nextResult);
      const nextMetadata = await getMediaMetadata(inputPath);
      setMetadata(nextMetadata);
    } catch (caught) {
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setError(caught as AppError);
    } finally {
      if (operationId === activeOperationIdRef.current) {
        activeTranscodeJobIdRef.current = null;
        setPhase("idle");
      }
    }
  }

  async function startSpeechAssessment() {
    if (!result) {
      return;
    }

    const operationId = ++activeOperationIdRef.current;
    const speechAbortController = new AbortController();
    speechAbortControllerRef.current = speechAbortController;
    setPhase("assessing");
    setError(null);
    setSpeechAssessmentResult(null);
    try {
      const azureConfigValidationResult = await validateAzureConfig();
      if (
        operationId !== activeOperationIdRef.current ||
        speechAbortController.signal.aborted
      ) {
        return;
      }
      if (!azureConfigValidationResult.ok) {
        setError({
          code: "AZURE_CONFIG_INVALID",
          message: azureConfigValidationResult.message,
        });
        return;
      }

      const nextSpeechAssessmentResult = await assessPronunciation(
        { wavPath: result.outputPath, durationMs: result.durationMs },
        speechAbortController.signal,
      );
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setSpeechAssessmentResult(nextSpeechAssessmentResult);
    } catch (caught) {
      if (operationId !== activeOperationIdRef.current) {
        return;
      }
      setError(caught as AppError);
    } finally {
      if (operationId === activeOperationIdRef.current) {
        speechAbortControllerRef.current = null;
        setPhase("idle");
      }
    }
  }

  async function cancelActiveOperation() {
    const activeJobId = activeTranscodeJobIdRef.current;
    const activeSpeechAbortController = speechAbortControllerRef.current;
    if (!activeJobId && !activeSpeechAbortController) {
      return;
    }

    activeOperationIdRef.current += 1;
    setPhase("canceling");
    activeSpeechAbortController?.abort();
    activeTranscodeJobIdRef.current = null;
    speechAbortControllerRef.current = null;
    if (activeJobId) {
      await cancelMediaTranscode(activeJobId).catch(() => ({
        jobId: activeJobId,
        canceled: false,
      }));
      setResult(null);
    }
    setSpeechAssessmentResult(null);
    setError(null);
    setPhase("idle");
  }

  function jumpToTranscriptWord(seconds: number) {
    if (!audioPlayerRef.current) {
      return;
    }

    audioPlayerRef.current.currentTime = seconds;
    void audioPlayerRef.current.play();
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const path = getBrowserDroppedFilePath(event.dataTransfer);
    if (!path) {
      setError({
        code: "MEDIA_DROP_PATH_UNAVAILABLE",
        message:
          "无法从浏览器拖拽事件读取本地路径，请使用“选择文件”按钮或 Tauri 窗口拖拽。",
      });
      return;
    }

    setInputPath(path);
    void loadMetadata(path);
  }

  const canTranscode =
    Boolean(inputPath.trim()) && Boolean(metadata?.supported) && !busy;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid gap-6">
        <Card>
          <div className="mb-5">
            <h2 className="text-xl font-semibold">媒体导入与转码</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              导入本地媒体文件，并转码为 Azure Pronunciation Assessment 推荐的
              WAV 16kHz 16bit mono PCM。
            </p>
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="grid min-h-[180px] place-items-center rounded-app border-2 border-dashed border-border bg-elevated/35 p-8 text-center"
          >
            <div>
              <FileAudio className="mx-auto text-primary" size={36} />
              <p className="mt-4 text-base font-semibold">
                拖入媒体文件，或选择本地文件
              </p>
              <p className="mt-1 text-sm text-muted">
                支持 {supportedExtensions}
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={chooseFile}
                disabled={busy}
                className="mt-5"
              >
                <FolderOpen size={16} className="mr-2" />
                选择文件
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <Field
              label="媒体文件路径"
              hint="也可以手动粘贴绝对路径；路径包含空格或中文时会作为独立参数交给系统转码器。"
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <TextInput
                  aria-label="媒体文件路径"
                  value={inputPath}
                  onChange={(event) => setInputPath(event.target.value)}
                  placeholder="/Users/.../sample.m4a"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void loadMetadata()}
                  disabled={busy || !inputPath.trim()}
                >
                  检查
                </Button>
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={startTranscode}
                disabled={!canTranscode}
              >
                {busy ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={16} className="mr-2" />
                )}
                转码为 WAV
              </Button>
              {phase === "transcoding" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void cancelActiveOperation()}
                >
                  <XCircle size={16} className="mr-2" />
                  取消
                </Button>
              ) : null}
              {metadata ? (
                <span
                  className={`text-sm font-semibold ${metadata.supported ? "text-primary-strong" : "text-danger"}`}
                >
                  {metadata.supported ? "格式可转码" : "格式不支持"}
                </span>
              ) : null}
            </div>

            {error ? (
              <div className="rounded-app border border-danger/30 bg-danger/10 p-4 text-sm leading-6 text-danger">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertCircle size={16} />
                  媒体处理失败
                </div>
                <p className="mt-1">{error.message}</p>
              </div>
            ) : null}
          </div>
        </Card>

        {result ? (
          <Card>
            <div className="mb-4 flex items-center gap-2 text-primary-strong">
              <CheckCircle2 size={18} />
              <h3 className="text-lg font-semibold">转码完成</h3>
            </div>
            <dl className="grid gap-3 text-sm">
              <InfoRow label="输出路径" value={result.outputPath} />
              <InfoRow
                label="格式"
                value={`${result.format.toUpperCase()} / ${result.sampleRate} Hz / ${result.channels} channel / ${result.codec}`}
              />
              <InfoRow label="时长" value={formatDuration(result.durationMs)} />
            </dl>
            {outputUrl ? (
              <audio
                ref={audioPlayerRef}
                controls
                src={outputUrl}
                className="mt-5 w-full"
              >
                <track kind="captions" />
              </audio>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                onClick={() => void startSpeechAssessment()}
                disabled={phase === "assessing"}
              >
                {phase === "assessing" ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 size={16} className="mr-2" />
                )}
                {phase === "assessing" ? "语音评估中" : "开始语音评估"}
              </Button>
              {phase === "assessing" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void cancelActiveOperation()}
                >
                  <XCircle size={16} className="mr-2" />
                  取消
                </Button>
              ) : null}
              <p className="text-sm leading-6 text-muted">
                使用 Azure continuous mode 评估长音频。
              </p>
            </div>
            {result.logSummary ? (
              <pre className="mt-5 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-app border border-border bg-elevated/35 p-3 text-xs leading-5 text-muted">
                {result.logSummary}
              </pre>
            ) : null}
          </Card>
        ) : null}

        {speechAssessmentResult ? (
          <Card>
            <div className="mb-4 flex items-center gap-2 text-primary-strong">
              <CheckCircle2 size={18} />
              <h3 className="text-lg font-semibold">Azure 语音评估完成</h3>
            </div>
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <ScoreBox
                label="Pron"
                value={speechAssessmentResult.overall.pronunciationScore}
              />
              <ScoreBox
                label="Accuracy"
                value={speechAssessmentResult.overall.accuracyScore}
              />
              <ScoreBox
                label="Fluency"
                value={speechAssessmentResult.overall.fluencyScore}
              />
              <ScoreBox
                label="Prosody"
                value={speechAssessmentResult.overall.prosodyScore}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-muted">
              Prosody 为 Azure
              官方韵律/语调自然度能力，覆盖重音、语调、语速和节奏；Completeness
              更适合 scripted reading，自由作答下不作为主指标。
            </p>
            <TranscriptTokenList
              tokens={transcriptTokens}
              onJumpToWord={jumpToTranscriptWord}
            />
          </Card>
        ) : null}
      </section>

      <aside className="grid h-fit gap-6">
        <Card>
          <h3 className="text-lg font-semibold">文件信息</h3>
          {metadata ? (
            <dl className="mt-4 grid gap-3 text-sm">
              <InfoRow label="文件名" value={metadata.fileName} />
              <InfoRow label="扩展名" value={metadata.extension || "无"} />
              <InfoRow label="大小" value={formatBytes(metadata.sizeBytes)} />
              <InfoRow
                label="时长"
                value={
                  metadata.durationMs
                    ? formatDuration(metadata.durationMs)
                    : "未知"
                }
              />
              <InfoRow
                label="支持状态"
                value={metadata.supported ? "支持" : "不支持"}
              />
            </dl>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">
              选择或检查文件后显示元数据。
            </p>
          )}
        </Card>

        <Card>
          <h3 className="text-lg font-semibold">系统转码器</h3>
          <p className="mt-3 text-sm leading-6 text-muted">
            后端使用 macOS 内置的 afconvert 与 afinfo 处理和验证音频。
          </p>
        </Card>
      </aside>
    </div>
  );
}

function ScoreBox({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-app border border-border bg-elevated/35 p-3">
      <div className="text-xs font-semibold uppercase text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold">
        {value === undefined ? "--" : value.toFixed(1)}
      </div>
    </div>
  );
}

function TranscriptTokenList({
  tokens,
  onJumpToWord,
}: {
  tokens: TranscriptToken[];
  onJumpToWord: (seconds: number) => void;
}) {
  if (!tokens.length) {
    return (
      <p className="mt-4 text-sm leading-6 text-muted">
        Azure 未返回逐词 transcript。
      </p>
    );
  }

  return (
    <div className="mt-5 max-h-[260px] overflow-y-auto rounded-app border border-border bg-elevated/35 p-4 text-sm leading-8">
      {tokens.map((token) => {
        if (token.type === "pause") {
          return (
            <span
              key={token.id}
              className="mx-1 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger"
            >
              [Pause: {(token.durationMs / 1000).toFixed(1)}s]
            </span>
          );
        }

        const isLowAccuracy =
          token.accuracyScore !== undefined &&
          token.accuracyScore < lowAccuracyThreshold;
        const titleParts = [
          token.accuracyScore === undefined
            ? ""
            : `Accuracy: ${token.accuracyScore.toFixed(1)}`,
          ...(token.phonemeErrors ?? []),
        ].filter(Boolean);

        return (
          <button
            key={token.id}
            type="button"
            title={titleParts.join("\n")}
            onClick={() => onJumpToWord(token.startMs / 1000)}
            className={`mx-0.5 rounded px-1 py-0.5 transition hover:bg-primary/10 ${
              isLowAccuracy
                ? "text-danger underline decoration-danger decoration-2 underline-offset-4"
                : ""
            }`}
          >
            {token.text}
          </button>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className="break-all text-text">{value}</dd>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function pathToAssetUrl(path: string) {
  return convertFileSrc(path);
}

function getBrowserDroppedFilePath(dataTransfer: DataTransfer) {
  const file = dataTransfer.files.item(0);
  return file ? ((file as File & { path?: string }).path ?? "") : "";
}
