import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAppConfig } from "../lib/config";
import { gradeSpeaking } from "../lib/grading";
import { getMediaMetadata, selectMediaFile, transcodeMedia } from "../lib/media";
import { assessPronunciation, validateAzureConfig } from "../lib/speech";
import { invokeCommand } from "../lib/tauri";
import { defaultPublicConfig, type PublicAppConfig } from "../types/config";

vi.mock("../lib/config", () => ({
  getAppConfig: vi.fn(),
}));

vi.mock("../lib/grading", () => ({
  gradeSpeaking: vi.fn(),
}));

vi.mock("../lib/media", () => ({
  getMediaMetadata: vi.fn(),
  selectMediaFile: vi.fn(),
  transcodeMedia: vi.fn(),
}));

vi.mock("../lib/speech", () => ({
  assessPronunciation: vi.fn(),
  validateAzureConfig: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  invokeCommand: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const configuredConfig: PublicAppConfig = {
  ...defaultPublicConfig,
  deepseek: {
    ...defaultPublicConfig.deepseek,
    apiKeyConfigured: true,
  },
  azure: {
    ...defaultPublicConfig.azure,
    keyConfigured: true,
    region: "eastasia",
    language: "en-US",
  },
};

const mockGradeResult = {
  overall_band: 6.5,
  sub_scores: {
    FC: 6,
    LR: 6.5,
    GRA: 6,
    PR: 6,
  },
  personal_style_comment: "表达清楚，但需要更具体的细节支撑。",
  vocabulary_corrections: [
    {
      original: "very happy",
      suggested: "delighted",
      reason: "表达更准确自然。",
    },
  ],
  reconstructed_essay: "I was delighted when my parents bought me a bicycle.",
};

const mockSpeechAssessmentResult = {
  overall: {
    accuracyScore: 86,
    fluencyScore: 82,
    completenessScore: 91,
    prosodyScore: 78,
    pronunciationScore: 84,
  },
  words: [
    {
      word: "Hello",
      startMs: 0,
      durationMs: 500,
      accuracyScore: 92,
    },
    {
      word: "world",
      startMs: 2800,
      durationMs: 500,
      accuracyScore: 55,
      phonemes: [{ phoneme: "er", accuracyScore: 41 }],
    },
  ],
  durationMs: 3300,
  recognizedText: "Hello world.",
};

function mockReadyAppConfig() {
  vi.mocked(getAppConfig).mockResolvedValue(configuredConfig);
  vi.mocked(invokeCommand).mockResolvedValue({
    ok: true,
    version: "0.1.0",
    platform: "darwin",
  });
  vi.mocked(validateAzureConfig).mockResolvedValue({
    ok: true,
    keyConfigured: true,
    region: "eastasia",
    language: "en-US",
    message: "Azure Speech 配置可用。",
  });
  vi.mocked(assessPronunciation).mockResolvedValue(mockSpeechAssessmentResult);
}

describe("App workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.clearAllMocks();
    mockReadyAppConfig();
  });

  it("starts without injecting the old demo correction record", async () => {
    window.localStorage.setItem(
      "ielts_copilot_correction_records",
      JSON.stringify([
        {
          id: "demo-assignment-technology",
          title: "雅思 Part 2: 科技对人类沟通的影响 (示范作业)",
          date: "2026-05-21 16:15",
          fileName: "ielts_speaking_sample_tech.mp3",
          duration: "00:30",
          transcript: [],
          result: {
            overallScore: 6,
            fluencyScore: { score: 6, feedback: "", strengths: [], improvements: [] },
            lexicalScore: { score: 6, feedback: "", strengths: [], improvements: [] },
            grammarScore: { score: 6, feedback: "", strengths: [], improvements: [] },
            pronunciationScore: { score: 6, feedback: "", strengths: [], improvements: [] },
            keyCorrections: [],
            generalFeedback: "",
            modelAnswer: "",
            transcript: [],
          },
        },
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("暂无历史口语作业")).toBeInTheDocument();
    });

    expect(screen.queryByText(/示范作业/)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("ielts_copilot_correction_records")).toBeNull();
  });

  it("creates a real history record after DeepSeek text grading succeeds", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手工手写文本" }));
    fireEvent.change(screen.getByPlaceholderText("复制粘贴或手写录入您的答题原稿内容..."), {
      target: { value: "This is a long enough IELTS speaking answer about a happy childhood memory." },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }));

    await waitFor(() => {
      expect(screen.getByText("表达清楚，但需要更具体的细节支撑。")).toBeInTheDocument();
    });

    expect(screen.getByText('"I was delighted when my parents bought me a bicycle."')).toBeInTheDocument();
    expect(screen.getByText(/B 6.5/)).toBeInTheDocument();
    expect(gradeSpeaking).toHaveBeenCalledWith({
      text: "This is a long enough IELTS speaking answer about a happy childhood memory.",
      part: "part2",
      question: "Describe a happy event in your childhood",
      ragExamples: [],
    });
  });

  it("loads selected media metadata, transcodes it, and runs Azure speech assessment", async () => {
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/音频 Sample.mp3");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/音频 Sample.mp3",
      fileName: "音频 Sample.mp3",
      extension: "mp3",
      sizeBytes: 4096,
      supported: true,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/音频 Sample.mp3",
      outputPath: "/Users/test/cache/音频 Sample-123.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      logSummary: "transcoded",
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动浏览文件" }));

    await waitFor(() => {
      expect(screen.getByText("音频 Sample.mp3")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "更换文件" })).toBeInTheDocument();
    expect(screen.queryByText("拖拽音频或视频文件至此处")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));

    await waitFor(() => {
      expect(screen.getByText("Azure 语音评估完成")).toBeInTheDocument();
    });

    expect(screen.getByText("Azure 长音频发音评估完成，已生成真实 transcript 和发音报告。")).toBeInTheDocument();
    expect(screen.getByText(/WAV \/ 16000 Hz \/ 1 channel \/ pcm_s16le/)).toBeInTheDocument();
    expect(screen.getByText(/\/Users\/test\/cache\/音频 Sample-123.wav/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("[Pause: 2.3s]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "world" })).toHaveClass("underline");
    expect(transcodeMedia).toHaveBeenCalledWith({ inputPath: "/Users/test/音频 Sample.mp3" });
    expect(validateAzureConfig).toHaveBeenCalled();
    expect(assessPronunciation).toHaveBeenCalledWith({
      wavPath: "/Users/test/cache/音频 Sample-123.wav",
      referenceText: "Describe a happy event in your childhood",
    });
  });

  it("shows clear workspace media errors for unsupported files and transcode failures", async () => {
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/audio.webm");
    vi.mocked(getMediaMetadata).mockResolvedValueOnce({
      path: "/Users/test/audio.webm",
      fileName: "audio.webm",
      extension: "webm",
      sizeBytes: 2048,
      supported: false,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动浏览文件" }));

    await waitFor(() => {
      expect(screen.getByText("仅支持 MP4、MP3、M4A 和 WAV 文件。")).toBeInTheDocument();
    });

    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/audio.m4a");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/audio.m4a",
      fileName: "audio.m4a",
      extension: "m4a",
      sizeBytes: 2048,
      supported: true,
    });
    vi.mocked(transcodeMedia).mockRejectedValue({
      code: "FFMPEG_START_FAILED",
      message: "无法启动 FFmpeg，请确认已安装或已配置 sidecar。",
    });

    fireEvent.click(screen.getByRole("button", { name: "更换文件" }));

    await waitFor(() => {
      expect(screen.getByText("audio.m4a")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));

    await waitFor(() => {
      expect(screen.getByText("无法启动 FFmpeg，请确认已安装或已配置 sidecar。")).toBeInTheDocument();
    });
  });

  it("uses browser file input without calling Tauri dialog in web preview", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "手动浏览文件" }));
    const browserFileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(browserFileInput).not.toBeNull();

    fireEvent.change(browserFileInput as HTMLInputElement, {
      target: {
        files: [new File(["sample"], "browser-sample.mp3", { type: "audio/mpeg" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("browser-sample.mp3")).toBeInTheDocument();
    });

    expect(selectMediaFile).not.toHaveBeenCalled();
    expect(screen.getByText("网页预览已读取文件信息；真实 FFmpeg 转码需要在 Tauri 桌面端运行。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始 AI 作业批改/ })).toBeDisabled();
  });
});
