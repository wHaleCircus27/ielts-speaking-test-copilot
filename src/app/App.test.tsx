import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { getAppConfig } from "../lib/config";
import { searchTeacherCases } from "../lib/corpus";
import { gradeSpeaking } from "../lib/grading";
import {
  cancelMediaTranscode,
  deleteGeneratedMediaFile,
  getMediaMetadata,
  reconcileGeneratedMedia,
  selectMediaFile,
  transcodeMedia,
} from "../lib/media";
import { assessPronunciation, validateAzureConfig } from "../lib/speech";
import { invokeCommand } from "../lib/tauri";
import { defaultPublicConfig, type PublicAppConfig } from "../types/config";
import type { TeacherCaseMatch } from "../types/corpus";

vi.mock("../lib/config", () => ({
  getAppConfig: vi.fn(),
}));

vi.mock("../lib/corpus", () => ({
  buildTeacherCaseSearchQuery: vi.fn((question: string, answer: string) => {
    const normalizedQuestion = question.trim();
    const normalizedAnswer = answer.trim();
    return normalizedQuestion && normalizedAnswer
      ? `Question: ${normalizedQuestion}\nAnswer: ${normalizedAnswer}`
      : normalizedAnswer || normalizedQuestion;
  }),
  mapTeacherCaseMatchesToRagExamples: vi.fn((matches: TeacherCaseMatch[]) =>
    matches.slice(0, 3).map((match) => ({
      originalText: match.case.originalText,
      revisedText: match.case.revisedText,
      teacherComment: match.case.teacherComment,
      scoringPreference: match.case.scoringPreference,
      score: match.score,
    })),
  ),
  mapTeacherCaseMatchesToRagReferences: vi.fn((matches: TeacherCaseMatch[]) =>
    matches.slice(0, 3).map((match) => ({
      caseId: match.case.id,
      score: match.score,
      originalText: match.case.originalText,
      revisedText: match.case.revisedText,
      teacherComment: match.case.teacherComment,
      scoringPreference: match.case.scoringPreference,
    })),
  ),
  searchTeacherCases: vi.fn(),
}));

vi.mock("../lib/grading", () => ({
  gradeSpeaking: vi.fn(),
}));

vi.mock("../lib/media", () => ({
  cancelMediaTranscode: vi.fn(),
  deleteGeneratedMediaFile: vi.fn(),
  getMediaMetadata: vi.fn(),
  reconcileGeneratedMedia: vi.fn(),
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

vi.mock("../features/settings/SettingsPage", () => ({
  SettingsPage: ({
    config,
    onConfigChange,
  }: {
    config: PublicAppConfig;
    onConfigChange: (config: PublicAppConfig) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onConfigChange({
          ...config,
          disclosure: { ...config.disclosure, noticeRequired: false },
        })
      }
    >
      确认迁移说明
    </button>
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const configuredConfig: PublicAppConfig = {
  ...defaultPublicConfig,
  deepseek: {
    ...defaultPublicConfig.deepseek,
    apiKeyConfigured: true,
    credentialStatus: "configured",
    enabled: true,
  },
  azure: {
    ...defaultPublicConfig.azure,
    keyConfigured: true,
    credentialStatus: "configured",
    enabled: true,
    region: "eastasia",
    language: "en-US",
  },
  disclosure: {
    ...defaultPublicConfig.disclosure,
    acceptedVersion: defaultPublicConfig.disclosure.latestVersion,
    noticeRequired: false,
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
    {
      word: "today",
      startMs: 3600,
      durationMs: 500,
      accuracyScore: 88,
    },
    {
      word: "clearly",
      startMs: 4200,
      durationMs: 700,
      accuracyScore: 84,
    },
  ],
  durationMs: 4900,
  recognizedText: "Hello world today clearly.",
};

function createStoredWorkspaceResult(overallScore: number) {
  return {
    overallScore,
    fluencyScore: {
      score: overallScore,
      feedback: "Fluency",
      strengths: [],
      improvements: [],
    },
    lexicalScore: {
      score: overallScore,
      feedback: "Lexical",
      strengths: [],
      improvements: [],
    },
    grammarScore: {
      score: overallScore,
      feedback: "Grammar",
      strengths: [],
      improvements: [],
    },
    pronunciationScore: {
      score: overallScore,
      feedback: "Pronunciation",
      strengths: [],
      improvements: [],
    },
    keyCorrections: [],
    generalFeedback: `Stored feedback ${overallScore}`,
    modelAnswer: "Stored model answer",
    transcript: [],
    transcriptTokens: [],
    speechAssessment: mockSpeechAssessmentResult,
  };
}

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
    vi.mocked(cancelMediaTranscode).mockResolvedValue({
      jobId: "test-job",
      canceled: true,
    });
    vi.mocked(deleteGeneratedMediaFile).mockResolvedValue(true);
    vi.mocked(reconcileGeneratedMedia).mockResolvedValue({
      removedFiles: 0,
      removedBytes: 0,
      totalBytes: 0,
      capacityBytes: 2 * 1024 * 1024 * 1024,
    });
    vi.mocked(searchTeacherCases).mockResolvedValue([]);
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
            fluencyScore: {
              score: 6,
              feedback: "",
              strengths: [],
              improvements: [],
            },
            lexicalScore: {
              score: 6,
              feedback: "",
              strengths: [],
              improvements: [],
            },
            grammarScore: {
              score: 6,
              feedback: "",
              strengths: [],
              improvements: [],
            },
            pronunciationScore: {
              score: 6,
              feedback: "",
              strengths: [],
              improvements: [],
            },
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
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
  });

  it("shows a non-blocking migrated disclosure notice until it is acknowledged", async () => {
    vi.mocked(getAppConfig).mockResolvedValueOnce({
      ...configuredConfig,
      disclosure: {
        latestVersion: 1,
        acceptedVersion: 1,
        noticeRequired: true,
      },
    });

    render(<App />);

    expect(
      await screen.findByText(
        "云服务数据流说明已更新，请查看迁移后的本地存储与云端处理边界。",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看数据说明" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "确认迁移说明" }),
    );
    await waitFor(() => {
      expect(
        screen.queryByText(
          "云服务数据流说明已更新，请查看迁移后的本地存储与云端处理边界。",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("preserves structurally invalid history and skips destructive media reconciliation", async () => {
    const invalidStoredHistory = JSON.stringify({ records: "not-an-array" });
    window.localStorage.setItem(
      "ielts_copilot_correction_records",
      invalidStoredHistory,
    );

    render(<App />);

    expect(
      await screen.findByText(
        "部分历史记录结构异常；原数据已保留，并已停止媒体清理。请先检查备份。",
      ),
    ).toBeInTheDocument();
    expect(reconcileGeneratedMedia).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBe(invalidStoredHistory);
  });

  it("preserves malformed history text and skips destructive media reconciliation", async () => {
    const malformedStoredHistory = "[{not-valid-json";
    window.localStorage.setItem(
      "ielts_copilot_correction_records",
      malformedStoredHistory,
    );

    render(<App />);

    expect(
      await screen.findByText(
        "历史记录数据无法解析；原数据已保留，并已停止媒体清理。请先检查备份。",
      ),
    ).toBeInTheDocument();
    expect(reconcileGeneratedMedia).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBe(malformedStoredHistory);
  });

  it("skips media reconciliation when normalized history cannot be persisted", async () => {
    const storedHistory = JSON.stringify([
      {
        id: "record-normalization-write-failure",
        title: "History requiring a safe write",
        date: "2026-07-19 18:00",
        fileName: "owned.wav",
        duration: "00:35",
        transcript: [],
        result: createStoredWorkspaceResult(7),
        audioPath:
          "/controlled/generated-media/99999999-9999-4999-8999-999999999999.wav",
      },
    ]);
    window.localStorage.setItem(
      "ielts_copilot_correction_records",
      storedHistory,
    );
    const originalSetItem = Storage.prototype.setItem;
    const storageWriteSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === "ielts_copilot_correction_records") {
          throw new DOMException("Storage unavailable", "QuotaExceededError");
        }
        return originalSetItem.call(this, key, value);
      });

    render(<App />);

    expect(
      await screen.findByText(
        "历史记录已读取，但规范化结果无法保存；原数据未覆盖，并已停止媒体清理。",
      ),
    ).toBeInTheDocument();
    expect(reconcileGeneratedMedia).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBe(storedHistory);
    storageWriteSpy.mockRestore();
  });

  it("creates a real history record after DeepSeek text grading succeeds", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "手工手写文本" }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("复制粘贴或手写录入您的答题原稿内容..."),
      {
        target: {
          value:
            "This is a long enough IELTS speaking answer about a happy childhood memory.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("表达清楚，但需要更具体的细节支撑。"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        '"I was delighted when my parents bought me a bicycle."',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/B 6.5/)).toBeInTheDocument();
    expect(gradeSpeaking).toHaveBeenCalledWith({
      text: "This is a long enough IELTS speaking answer about a happy childhood memory.",
      part: "part2",
      question: undefined,
      ragExamples: [],
    });
  });

  it("keeps edits made after submission while a successful grading request is pending", async () => {
    let resolvePendingGrade!: (value: typeof mockGradeResult) => void;
    vi.mocked(gradeSpeaking).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePendingGrade = resolve;
        }),
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "手工手写文本" }),
    );
    const titleInput = screen.getByPlaceholderText(
      "例如: Part 2 科技对生活的影响",
    );
    const questionInput = screen.getByPlaceholderText(
      "例如: Describe a memorable trip",
    );
    const answerInput = screen.getByPlaceholderText(
      "复制粘贴或手写录入您的答题原稿内容...",
    );
    fireEvent.change(titleInput, { target: { value: "Submitted title" } });
    fireEvent.change(questionInput, {
      target: { value: "Describe a submitted topic" },
    });
    fireEvent.change(answerInput, {
      target: {
        value:
          "This is the submitted answer and it is long enough for the grading request.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }),
    );
    await waitFor(() => expect(gradeSpeaking).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "音视频录传" })).toBeDisabled();

    fireEvent.change(titleInput, { target: { value: "Next draft title" } });
    fireEvent.change(questionInput, {
      target: { value: "Describe the next topic" },
    });
    fireEvent.change(answerInput, {
      target: {
        value:
          "This next draft was typed while the previous request was pending and must remain.",
      },
    });
    await act(async () => {
      resolvePendingGrade(mockGradeResult);
      await Promise.resolve();
    });

    expect(titleInput).toHaveValue("Next draft title");
    expect(questionInput).toHaveValue("Describe the next topic");
    expect(answerInput).toHaveValue(
      "This next draft was typed while the previous request was pending and must remain.",
    );
  });

  it("keeps every text field when grading or history persistence fails", async () => {
    vi.mocked(gradeSpeaking).mockRejectedValueOnce({
      code: "GRADING_REQUEST_FAILED",
      message: "批改服务暂时不可用。",
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "手工手写文本" }),
    );
    const titleInput = screen.getByPlaceholderText(
      "例如: Part 2 科技对生活的影响",
    );
    const questionInput = screen.getByPlaceholderText(
      "例如: Describe a memorable trip",
    );
    const answerInput = screen.getByPlaceholderText(
      "复制粘贴或手写录入您的答题原稿内容...",
    );
    const partSelect = screen.getByLabelText("考试部分");
    fireEvent.change(titleInput, { target: { value: "失败后保留的标题" } });
    fireEvent.change(questionInput, {
      target: { value: "Describe a useful skill" },
    });
    fireEvent.change(partSelect, { target: { value: "part3" } });
    fireEvent.change(answerInput, {
      target: {
        value:
          "This answer is deliberately long enough to submit and must remain available for retry.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }),
    );

    expect(await screen.findByText("批改服务暂时不可用。")).toBeInTheDocument();
    expect(titleInput).toHaveValue("失败后保留的标题");
    expect(questionInput).toHaveValue("Describe a useful skill");
    expect(partSelect).toHaveValue("part3");
    expect(answerInput).toHaveValue(
      "This answer is deliberately long enough to submit and must remain available for retry.",
    );

    vi.mocked(gradeSpeaking).mockResolvedValueOnce(mockGradeResult);
    const originalSetItem = Storage.prototype.setItem;
    const storageWriteSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === "ielts_copilot_correction_records") {
          throw new DOMException(
            "Storage quota exceeded",
            "QuotaExceededError",
          );
        }
        return originalSetItem.call(this, key, value);
      });
    fireEvent.click(
      screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }),
    );

    expect(
      await screen.findByText(
        "批改未完成，请检查服务配置后重试。输入内容已保留。",
      ),
    ).toBeInTheDocument();
    expect(answerInput).toHaveValue(
      "This answer is deliberately long enough to submit and must remain available for retry.",
    );
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
    storageWriteSpy.mockRestore();
  });

  it("resets the whole workspace and ignores a grading result from the previous session", async () => {
    let resolvePendingGrade!: (value: typeof mockGradeResult) => void;
    vi.mocked(gradeSpeaking).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePendingGrade = resolve;
        }),
    );

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "手工手写文本" }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("例如: Part 2 科技对生活的影响"),
      {
        target: { value: "待取消会话" },
      },
    );
    fireEvent.change(
      screen.getByPlaceholderText("例如: Describe a memorable trip"),
      {
        target: { value: "Describe a canceled attempt" },
      },
    );
    fireEvent.change(screen.getByLabelText("考试部分"), {
      target: { value: "part1" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("复制粘贴或手写录入您的答题原稿内容..."),
      {
        target: {
          value:
            "This pending answer belongs only to the old workspace session and must be ignored.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /开始 DeepSeek 文本批改/ }),
    );
    await waitFor(() => {
      expect(gradeSpeaking).toHaveBeenCalledOnce();
    });
    fireEvent.click(screen.getByRole("button", { name: "新口语作业批改" }));

    expect(
      screen.getByPlaceholderText("例如: Part 2 科技对生活的影响"),
    ).toHaveValue("");
    expect(
      screen.getByPlaceholderText("例如: Describe a memorable trip"),
    ).toHaveValue("");
    expect(screen.getByLabelText("考试部分")).toHaveValue("part2");
    fireEvent.click(screen.getByRole("button", { name: "手工手写文本" }));
    expect(
      screen.getByPlaceholderText("复制粘贴或手写录入您的答题原稿内容..."),
    ).toHaveValue("");

    await act(async () => {
      resolvePendingGrade(mockGradeResult);
      await Promise.resolve();
    });

    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
    expect(
      screen.queryByText("表达清楚，但需要更具体的细节支撑。"),
    ).not.toBeInTheDocument();
  });

  it("ignores a file picker result that resolves after the workspace was reset", async () => {
    let resolvePendingMediaSelection!: (path: string) => void;
    vi.mocked(selectMediaFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePendingMediaSelection = resolve;
        }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "文件" }));
    fireEvent.click(screen.getByRole("button", { name: /导入音视频/ }));
    await waitFor(() => expect(selectMediaFile).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "文件" }));
    fireEvent.click(
      screen.getByRole("button", { name: "新建批改会话 (重置)" }),
    );

    await act(async () => {
      resolvePendingMediaSelection("/controlled/input/late-session.m4a");
      await Promise.resolve();
    });

    expect(getMediaMetadata).not.toHaveBeenCalledWith(
      "/controlled/input/late-session.m4a",
    );
    expect(screen.getByText("拖拽音频或视频文件至此处")).toBeInTheDocument();
  });

  it("plays only the active record audio and does not guess audio for legacy records", async () => {
    window.localStorage.setItem(
      "ielts_copilot_correction_records",
      JSON.stringify([
        {
          id: "record-first",
          title: "第一条媒体记录",
          date: "2026-07-19 10:00",
          fileName: "first.mp3",
          duration: "00:35",
          transcript: [],
          result: createStoredWorkspaceResult(7),
          audioPath:
            "/controlled/generated-media/11111111-1111-4111-8111-111111111111.wav",
        },
        {
          id: "record-second",
          title: "第二条媒体记录",
          date: "2026-07-19 09:00",
          fileName: "second.m4a",
          duration: "00:36",
          transcript: [],
          result: createStoredWorkspaceResult(6.5),
          audioPath:
            "/controlled/generated-media/22222222-2222-4222-8222-222222222222.wav",
        },
        {
          id: "record-legacy",
          title: "旧版无音频路径记录",
          date: "2026-07-19 08:00",
          fileName: "legacy.wav",
          duration: "00:37",
          transcript: [],
          result: createStoredWorkspaceResult(6),
        },
      ]),
    );

    const { container } = render(<App />);

    await screen.findByText("Stored feedback 7");
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "asset:///controlled/generated-media/11111111-1111-4111-8111-111111111111.wav",
    );

    fireEvent.click(screen.getByRole("button", { name: /第二条媒体记录/ }));
    await screen.findByText("Stored feedback 6.5");
    expect(container.querySelector("audio")).toHaveAttribute(
      "src",
      "asset:///controlled/generated-media/22222222-2222-4222-8222-222222222222.wav",
    );

    fireEvent.click(screen.getByRole("button", { name: /旧版无音频路径记录/ }));
    expect(
      await screen.findByText(
        "历史音频不可用。此记录没有可读取的受控 WAV 文件。",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("loads selected media metadata, transcodes it, and runs Azure speech assessment", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);
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
      outputPath:
        "/Users/test/app-data/generated-media/11111111-1111-4111-8111-111111111111.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 4900,
      logSummary: "transcoded",
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );

    await waitFor(() => {
      expect(screen.getByText("音频 Sample.mp3")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "更换文件" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("拖拽音频或视频文件至此处"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));

    await waitFor(() => {
      expect(assessPronunciation).toHaveBeenCalledOnce();
      expect(gradeSpeaking).toHaveBeenCalledOnce();
      expect(screen.getByText("Azure 语音评估完成")).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        "Azure 长音频发音评估完成，DeepSeek 已基于 transcript 补充词汇、语法和话题内容。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/WAV \/ 16000 Hz \/ 1 channel \/ pcm_s16le/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /\/Users\/test\/app-data\/generated-media\/11111111-1111-4111-8111-111111111111.wav/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
    expect(screen.getByText("[Pause: 2.3s]")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "world" })).toHaveClass(
      "underline",
    );
    expect(transcodeMedia).toHaveBeenCalledWith({
      inputPath: "/Users/test/音频 Sample.mp3",
      jobId: expect.any(String),
    });
    expect(validateAzureConfig).toHaveBeenCalled();
    expect(assessPronunciation).toHaveBeenCalledWith(
      {
        wavPath:
          "/Users/test/app-data/generated-media/11111111-1111-4111-8111-111111111111.wav",
        durationMs: 4900,
      },
      expect.any(AbortSignal),
    );
    expect(gradeSpeaking).toHaveBeenCalledWith({
      text: "Hello world today clearly.",
      question: undefined,
      part: "part2",
      ragExamples: [],
    });
  });

  it("deletes an unarchived WAV and keeps the selected file when media history persistence fails", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/retry.m4a");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/retry.m4a",
      fileName: "retry.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
      durationMs: 35_000,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/retry.m4a",
      outputPath:
        "/controlled/generated-media/33333333-3333-4333-8333-333333333333.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 35_000,
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );
    await screen.findByText("retry.m4a");

    const originalSetItem = Storage.prototype.setItem;
    const storageWriteSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === "ielts_copilot_correction_records") {
          throw new DOMException(
            "Storage quota exceeded",
            "QuotaExceededError",
          );
        }
        return originalSetItem.call(this, key, value);
      });
    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));

    expect(
      await screen.findByText(
        "媒体批改未完成，所选文件仍保留，可修复问题后重试。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("retry.m4a")).toBeInTheDocument();
    expect(deleteGeneratedMediaFile).toHaveBeenCalledWith(
      "/controlled/generated-media/33333333-3333-4333-8333-333333333333.wav",
    );
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
    storageWriteSpy.mockRestore();
  });

  it("aborts Azure assessment and removes the unarchived WAV when the user cancels", async () => {
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/cancel.m4a");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/cancel.m4a",
      fileName: "cancel.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
      durationMs: 35_000,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/cancel.m4a",
      outputPath:
        "/controlled/generated-media/44444444-4444-4444-8444-444444444444.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 35_000,
    });
    let assessmentSignal: AbortSignal | undefined;
    vi.mocked(assessPronunciation).mockImplementation(
      (_request, abortSignal) => {
        assessmentSignal = abortSignal;
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () =>
              reject({
                code: "AZURE_SPEECH_CANCELED",
                message: "Azure 语音评估已取消。",
              }),
            { once: true },
          );
        });
      },
    );

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );
    await screen.findByText("cancel.m4a");
    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));
    await waitFor(() => expect(assessPronunciation).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(assessmentSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(deleteGeneratedMediaFile).toHaveBeenCalledWith(
        "/controlled/generated-media/44444444-4444-4444-8444-444444444444.wav",
      ),
    );
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
  });

  it("ignores late media grading after a session reset and removes its unarchived WAV", async () => {
    let resolvePendingGrade!: (value: typeof mockGradeResult) => void;
    vi.mocked(gradeSpeaking).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePendingGrade = resolve;
        }),
    );
    vi.mocked(selectMediaFile).mockResolvedValue("/Users/test/late.m4a");
    vi.mocked(getMediaMetadata).mockResolvedValue({
      path: "/Users/test/late.m4a",
      fileName: "late.m4a",
      extension: "m4a",
      sizeBytes: 4096,
      supported: true,
      durationMs: 35_000,
    });
    vi.mocked(transcodeMedia).mockResolvedValue({
      inputPath: "/Users/test/late.m4a",
      outputPath:
        "/controlled/generated-media/55555555-5555-4555-8555-555555555555.wav",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      codec: "pcm_s16le",
      durationMs: 35_000,
    });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );
    await screen.findByText("late.m4a");
    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));
    await waitFor(() => expect(gradeSpeaking).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "新口语作业批改" }));
    await act(async () => {
      resolvePendingGrade(mockGradeResult);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(deleteGeneratedMediaFile).toHaveBeenCalledWith(
        "/controlled/generated-media/55555555-5555-4555-8555-555555555555.wav",
      ),
    );
    expect(
      window.localStorage.getItem("ielts_copilot_correction_records"),
    ).toBeNull();
    expect(screen.getByText("拖拽音频或视频文件至此处")).toBeInTheDocument();
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

    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("仅支持 MP4、MP3、M4A 和 WAV 文件。"),
      ).toBeInTheDocument();
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
      code: "MEDIA_AFCONVERT_UNAVAILABLE",
      message: "无法启动 macOS 系统转码工具。",
    });

    fireEvent.click(screen.getByRole("button", { name: "更换文件" }));

    await waitFor(() => {
      expect(screen.getByText("audio.m4a")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /开始 AI 作业批改/ }));

    await waitFor(() => {
      expect(
        screen.getByText("无法启动 macOS 系统转码工具。"),
      ).toBeInTheDocument();
    });
  });

  it("uses browser file input without calling Tauri dialog in web preview", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;

    const { container } = render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "手动浏览文件" }),
    );
    const browserFileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(browserFileInput).not.toBeNull();

    fireEvent.change(browserFileInput as HTMLInputElement, {
      target: {
        files: [
          new File(["sample"], "browser-sample.mp3", { type: "audio/mpeg" }),
        ],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("browser-sample.mp3")).toBeInTheDocument();
    });

    expect(selectMediaFile).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "网页预览只能读取文件信息；真实转码请使用 Tauri 桌面端。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /开始 AI 作业批改/ }),
    ).toBeDisabled();
  });
});
