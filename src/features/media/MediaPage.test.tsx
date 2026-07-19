import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPage } from "./MediaPage";
import {
  cancelMediaTranscode,
  getMediaMetadata,
  selectMediaFile,
  transcodeMedia,
} from "../../lib/media";
import { assessPronunciation, validateAzureConfig } from "../../lib/speech";

vi.mock("../../lib/media", () => ({
  cancelMediaTranscode: vi.fn(),
  getMediaMetadata: vi.fn(),
  selectMediaFile: vi.fn(),
  transcodeMedia: vi.fn(),
}));

vi.mock("../../lib/speech", () => ({
  assessPronunciation: vi.fn(),
  validateAzureConfig: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  }),
}));

describe("MediaPage", () => {
  beforeEach(() => {
    vi.mocked(getMediaMetadata).mockReset();
    vi.mocked(cancelMediaTranscode).mockReset();
    vi.mocked(selectMediaFile).mockReset();
    vi.mocked(transcodeMedia).mockReset();
    vi.mocked(assessPronunciation).mockReset();
    vi.mocked(validateAzureConfig).mockReset();
    vi.mocked(validateAzureConfig).mockResolvedValue({
      ok: true,
      keyConfigured: true,
      region: "eastasia",
      language: "en-US",
      message: "Azure Speech 配置可用。",
    });
    vi.mocked(cancelMediaTranscode).mockResolvedValue({
      jobId: "00000000-0000-4000-8000-000000000000",
      canceled: true,
    });
  });

  it("loads metadata for a selected media file", async () => {
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/Sample File.mp3");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/Sample File.mp3",
      fileName: "Sample File.mp3",
      extension: "mp3",
      sizeBytes: 2048,
      supported: true,
    });

    render(<MediaPage />);
    fireEvent.click(screen.getByRole("button", { name: /选择文件/ }));

    await waitFor(() => {
      expect(screen.getByText("Sample File.mp3")).toBeInTheDocument();
    });

    expect(screen.getByText("格式可转码")).toBeInTheDocument();
  });

  it("transcodes a supported media file and renders output metadata", async () => {
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/audio.m4a",
      fileName: "audio.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/audio.m4a",
      outputPath: "/Users/test/cache/audio.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 3_500,
      logSummary: "transcoded",
    });

    render(<MediaPage />);
    fireEvent.change(screen.getByLabelText("媒体文件路径"), {
      target: { value: "/Users/test/audio.m4a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("格式可转码")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /转码为 WAV/ }));

    await waitFor(() => {
      expect(screen.getByText("转码完成")).toBeInTheDocument();
    });

    expect(screen.getByText("/Users/test/cache/audio.wav")).toBeInTheDocument();
    expect(transcodeMedia).toHaveBeenCalledWith({
      inputPath: "/Users/test/audio.m4a",
      jobId: expect.any(String),
    });
  });

  it("runs Azure speech assessment after transcode and renders transcript tokens", async () => {
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/audio.m4a",
      fileName: "audio.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/audio.m4a",
      outputPath: "/Users/test/cache/audio.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 3_500,
      logSummary: "transcoded",
    });
    vi.mocked(assessPronunciation).mockResolvedValue({
      overall: {
        pronunciationScore: 84,
        accuracyScore: 86,
        fluencyScore: 82,
        prosodyScore: 78,
      },
      words: [
        { word: "Hello", startMs: 0, durationMs: 500, accuracyScore: 92 },
        { word: "world", startMs: 2800, durationMs: 500, accuracyScore: 55 },
      ],
      durationMs: 3300,
      recognizedText: "Hello world.",
    });

    render(<MediaPage />);
    fireEvent.change(screen.getByLabelText("媒体文件路径"), {
      target: { value: "/Users/test/audio.m4a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("格式可转码")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /转码为 WAV/ }));

    await waitFor(() => {
      expect(screen.getByText("转码完成")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /开始语音评估/ }));

    await waitFor(() => {
      expect(screen.getByText("Azure 语音评估完成")).toBeInTheDocument();
    });

    expect(screen.getByText("84.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("[Pause: 2.3s]")).toBeInTheDocument();
    expect(assessPronunciation).toHaveBeenCalledWith(
      { wavPath: "/Users/test/cache/audio.wav", durationMs: 3_500 },
      expect.any(AbortSignal),
    );
  });

  it("blocks transcode when the selected media type is unsupported", async () => {
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/notes.txt",
      fileName: "notes.txt",
      extension: "txt",
      sizeBytes: 512,
      supported: false,
    });

    render(<MediaPage />);
    fireEvent.change(screen.getByLabelText("媒体文件路径"), {
      target: { value: "/Users/test/notes.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("格式不支持")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /转码为 WAV/ })).toBeDisabled();
  });

  it("shows a clear error when transcode fails", async () => {
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/broken.mp3",
      fileName: "broken.mp3",
      extension: "mp3",
      sizeBytes: 1024,
      supported: true,
    });
    vi.mocked(transcodeMedia).mockRejectedValue({
      code: "MEDIA_TRANSCODE_FAILED",
      message: "媒体转码失败。",
    });

    render(<MediaPage />);
    fireEvent.change(screen.getByLabelText("媒体文件路径"), {
      target: { value: "/Users/test/broken.mp3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));

    await waitFor(() => {
      expect(screen.getByText("格式可转码")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /转码为 WAV/ }));

    await waitFor(() => {
      expect(screen.getByText("媒体处理失败")).toBeInTheDocument();
    });

    expect(screen.getByText("媒体转码失败。")).toBeInTheDocument();
  });

  it("cancels an active transcode job by job id", async () => {
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/long.m4a",
      fileName: "long.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
      durationMs: 35_000,
    });
    vi.mocked(transcodeMedia).mockImplementation(
      () => new Promise(() => undefined),
    );

    render(<MediaPage />);
    fireEvent.change(screen.getByLabelText("媒体文件路径"), {
      target: { value: "/Users/test/long.m4a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检查" }));
    await screen.findByText("格式可转码");

    fireEvent.click(screen.getByRole("button", { name: /转码为 WAV/ }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(cancelMediaTranscode).toHaveBeenCalledWith(expect.any(String));
    });
  });
});
