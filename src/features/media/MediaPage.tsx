import { Card } from "../../components/Card";

export function MediaPage() {
  return (
    <Card>
      <h3 className="text-lg font-semibold">媒体处理</h3>
      <p className="mt-2 text-sm leading-6 text-muted">
        MVP 2 将在这里接入本地文件导入、FFmpeg sidecar 转码和音频播放器。
      </p>
    </Card>
  );
}
