import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPage } from "./MediaPage";
import { getMediaMetadata, selectMediaFile, transcodeMedia } from "../../lib/media";

vi.mock("../../lib/media", () => ({
  getMediaMetadata: vi.fn(),
  selectMediaFile: vi.fn(),
  transcodeMedia: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

describe("MediaPage", () => {
  beforeEach(() => {
    vi.mocked(getMediaMetadata).mockReset();
    vi.mocked(selectMediaFile).mockReset();
    vi.mocked(transcodeMedia).mockReset();
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
    expect(transcodeMedia).toHaveBeenCalledWith({ inputPath: "/Users/test/audio.m4a" });
  });
});
