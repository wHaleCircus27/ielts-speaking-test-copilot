# 05 媒体处理

## 目标

支持用户导入 MP4、MP3、M4A、WAV，并通过本地 FFmpeg sidecar 转码为 Azure 语音评估适用的 WAV 格式。

## 不做什么

- 不做复杂视频预览。
- 不做批量转码。
- 不做音频剪辑编辑器。

## 用户流程

1. 用户进入媒体页或批改页音频区域。
2. 拖入或选择媒体文件。
3. 应用校验格式。
4. Rust 后端调用 FFmpeg 转码。
5. 前端展示转码状态和音频播放器。

## 技术设计

- 前端使用 Tauri dialog 或拖拽事件获取文件路径。
- Rust command 校验扩展名和文件存在性。
- FFmpeg 作为 Tauri sidecar 放置在 `src-tauri/binaries`。
- macOS 开发环境中如 FFmpeg 缺失，可使用系统 `afconvert` 作为后备转码器，输出参数保持一致。
- 输出格式固定为 `WAV 16kHz 16bit mono PCM`。
- 输出文件写入应用缓存目录或用户指定临时目录。
- 转码完成后返回输出路径、时长、日志摘要。

## FFmpeg 参数

```bash
ffmpeg -y -i "{input}" -ar 16000 -ac 1 -c:a pcm_s16le "{output}.wav"
```

## 数据结构

```ts
type MediaImportRequest = {
  inputPath: string;
};

type MediaTranscodeResult = {
  inputPath: string;
  outputPath: string;
  format: "wav";
  sampleRate: 16000;
  channels: 1;
  codec: "pcm_s16le";
  durationMs?: number;
  logSummary?: string;
};
```

## Tauri commands

- `select_media_file() -> string | null`
- `transcode_media(request: MediaImportRequest) -> MediaTranscodeResult`
- `get_media_metadata(path: string) -> MediaMetadata`

## 任务拆分

- M-001：实现媒体文件选择和拖拽区域。
- M-002：实现扩展名和空文件校验。
- M-003：配置 FFmpeg sidecar。
- M-004：实现 Rust 转码 command。
- M-005：实现转码进度和失败状态。
- M-006：实现音频播放器加载输出 WAV。
- M-007：记录转码日志摘要，隐藏敏感本地细节。

## 验收标准

- MP4、MP3、M4A、WAV 均可导入。
- 输出 WAV 参数符合 `16kHz 16bit mono PCM`。
- FFmpeg 不存在时显示明确错误。
- 转码失败不会阻塞 UI。
- 同一个文件重复转码不会覆盖用户原始文件。

## 测试建议

- 单元测试：扩展名校验。
- 单元测试：FFmpeg 参数生成。
- 集成测试：mock sidecar 成功和失败。
- 手动测试：不同格式媒体转码。

## 风险与后续扩展

- ARM64 FFmpeg 二进制来源需要固定。
- 本地路径可能包含空格和中文，调用参数必须使用安全参数数组而不是拼接 shell 字符串。
