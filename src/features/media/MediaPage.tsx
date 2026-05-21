import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle2, FileAudio, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, TextInput } from "../../components/Field";
import { getMediaMetadata, selectMediaFile, transcodeMedia } from "../../lib/media";
import type { AppError } from "../../types/errors";
import type { MediaMetadata, MediaTranscodeResult } from "../../types/media";

const supportedExtensions = "MP4, MP3, M4A, WAV";

export function MediaPage() {
  const [inputPath, setInputPath] = useState("");
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [result, setResult] = useState<MediaTranscodeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const outputUrl = useMemo(() => (result ? pathToAssetUrl(result.outputPath) : null), [result]);

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
    if (!path.trim()) {
      setMetadata(null);
      setResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const nextMetadata = await getMediaMetadata(path);
      setMetadata(nextMetadata);
    } catch (caught) {
      setMetadata(null);
      setError(caught as AppError);
    } finally {
      setBusy(false);
    }
  }

  async function startTranscode() {
    if (!inputPath.trim()) {
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const nextResult = await transcodeMedia({ inputPath });
      setResult(nextResult);
      const nextMetadata = await getMediaMetadata(inputPath);
      setMetadata(nextMetadata);
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    const path = file ? getDroppedFilePath(file) : "";
    if (!path) {
      setError({
        code: "MEDIA_DROP_PATH_UNAVAILABLE",
        message: "无法从拖拽文件读取本地路径，请使用“选择文件”按钮。",
      });
      return;
    }

    setInputPath(path);
    void loadMetadata(path);
  }

  const canTranscode = Boolean(inputPath.trim()) && Boolean(metadata?.supported) && !busy;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="grid gap-6">
        <Card>
          <div className="mb-5">
            <h2 className="text-xl font-semibold">媒体导入与转码</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              导入本地媒体文件，并转码为 Azure Pronunciation Assessment 推荐的 WAV 16kHz 16bit mono PCM。
            </p>
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            className="grid min-h-[180px] place-items-center rounded-app border-2 border-dashed border-border bg-elevated/35 p-8 text-center"
          >
            <div>
              <FileAudio className="mx-auto text-primary" size={36} />
              <p className="mt-4 text-base font-semibold">拖入媒体文件，或选择本地文件</p>
              <p className="mt-1 text-sm text-muted">支持 {supportedExtensions}</p>
              <Button type="button" variant="primary" onClick={chooseFile} disabled={busy} className="mt-5">
                <FolderOpen size={16} className="mr-2" />
                选择文件
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            <Field label="媒体文件路径" hint="也可以手动粘贴绝对路径；路径包含空格或中文时会按参数数组传给 FFmpeg。">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <TextInput
                  aria-label="媒体文件路径"
                  value={inputPath}
                  onChange={(event) => setInputPath(event.target.value)}
                  placeholder="/Users/.../sample.m4a"
                />
                <Button type="button" variant="secondary" onClick={() => void loadMetadata()} disabled={busy || !inputPath.trim()}>
                  检查
                </Button>
              </div>
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" onClick={startTranscode} disabled={!canTranscode}>
                {busy ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />}
                转码为 WAV
              </Button>
              {metadata ? (
                <span className={`text-sm font-semibold ${metadata.supported ? "text-primary-strong" : "text-danger"}`}>
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
              <InfoRow label="格式" value={`${result.format.toUpperCase()} / ${result.sampleRate} Hz / ${result.channels} channel / ${result.codec}`} />
            </dl>
            {outputUrl ? (
              <audio controls src={outputUrl} className="mt-5 w-full">
                <track kind="captions" />
              </audio>
            ) : null}
            {result.logSummary ? (
              <pre className="mt-5 max-h-[160px] overflow-auto whitespace-pre-wrap rounded-app border border-border bg-elevated/35 p-3 text-xs leading-5 text-muted">
                {result.logSummary}
              </pre>
            ) : null}
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
              <InfoRow label="支持状态" value={metadata.supported ? "支持" : "不支持"} />
            </dl>
          ) : (
            <p className="mt-3 text-sm leading-6 text-muted">选择或检查文件后显示元数据。</p>
          )}
        </Card>

        <Card>
          <h3 className="text-lg font-semibold">FFmpeg 要求</h3>
          <p className="mt-3 text-sm leading-6 text-muted">
            后端会优先读取 `FFMPEG_PATH`，其次查找 `src-tauri/binaries/ffmpeg` 或系统 `ffmpeg`。缺失时会返回明确错误，不会阻塞页面。
          </p>
        </Card>
      </aside>
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

function pathToAssetUrl(path: string) {
  return convertFileSrc(path);
}

function getDroppedFilePath(file: File) {
  return (
    (file as File & { path?: string }).path ??
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ??
    ""
  );
}
