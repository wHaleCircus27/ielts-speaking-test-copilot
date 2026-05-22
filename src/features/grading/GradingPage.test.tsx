import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GradingPage } from "./GradingPage";
import { defaultPublicConfig, type PublicAppConfig } from "../../types/config";
import { searchTeacherCases } from "../../lib/corpus";
import { gradeSpeaking } from "../../lib/grading";
import type { TeacherCaseMatch } from "../../types/corpus";

vi.mock("../../lib/corpus", () => ({
  mapTeacherCaseMatchesToRagExamples: vi.fn((matches: TeacherCaseMatch[]) =>
    matches.slice(0, 3).map((match) => ({
      originalText: match.case.originalText,
      revisedText: match.case.revisedText,
      teacherComment: match.case.teacherComment,
      scoringPreference: match.case.scoringPreference,
    })),
  ),
  searchTeacherCases: vi.fn(),
}));

vi.mock("../../lib/grading", () => ({
  gradeSpeaking: vi.fn(),
}));

const configuredConfig: PublicAppConfig = {
  ...defaultPublicConfig,
  deepseek: {
    ...defaultPublicConfig.deepseek,
    apiKeyConfigured: true,
  },
};

const mockGradeResult = {
  overall_band: 6.5,
  sub_scores: {
    FC: 6,
    LR: 6.5,
    GRA: 6,
    PR: 6.5,
  },
  personal_style_comment: "表达基本连贯，建议减少重复并增强细节。",
  vocabulary_corrections: [
    {
      original: "very happy",
      suggested: "delighted",
      reason: "更自然且更具体。",
    },
  ],
  reconstructed_essay: "I was delighted when my parents bought me a bicycle.",
};

describe("GradingPage", () => {
  beforeEach(() => {
    vi.mocked(gradeSpeaking).mockReset();
    vi.mocked(searchTeacherCases).mockReset();
  });

  it("does not call gradeSpeaking when DeepSeek key is missing", () => {
    render(<GradingPage config={defaultPublicConfig} serviceReady />);

    fireEvent.change(screen.getByLabelText("学生回答文本"), {
      target: { value: "This is a long enough speaking answer for the form." },
    });
    fireEvent.click(screen.getByRole("button", { name: /生成批改报告/ }));

    expect(gradeSpeaking).not.toHaveBeenCalled();
    expect(screen.getByText(/请先在设置页保存 DeepSeek API Key/)).toBeInTheDocument();
  });

  it("renders real GradeResult data after submission", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);
    render(<GradingPage config={configuredConfig} serviceReady />);

    fireEvent.change(screen.getByLabelText("学生回答文本"), {
      target: { value: "This is a long enough speaking answer for DeepSeek grading." },
    });
    fireEvent.click(screen.getByRole("button", { name: /生成批改报告/ }));

    await waitFor(() => {
      expect(screen.getByText("批改报告")).toBeInTheDocument();
    });

    expect(screen.getAllByText("6.5").length).toBeGreaterThan(0);
    expect(screen.getByText("表达基本连贯，建议减少重复并增强细节。")).toBeInTheDocument();
    expect(screen.getByText("very happy")).toBeInTheDocument();
    expect(screen.getByText("delighted")).toBeInTheDocument();
    expect(screen.getByText("I was delighted when my parents bought me a bicycle.")).toBeInTheDocument();
  });

  it("submits without RAG examples when Zhipu key is not configured", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);
    render(<GradingPage config={configuredConfig} serviceReady />);

    fireEvent.change(screen.getByLabelText("学生回答文本"), {
      target: { value: "This is a long enough speaking answer for normal grading without RAG." },
    });
    fireEvent.click(screen.getByRole("button", { name: /生成批改报告/ }));

    await waitFor(() => {
      expect(gradeSpeaking).toHaveBeenCalledWith({
        text: "This is a long enough speaking answer for normal grading without RAG.",
        part: "part2",
        question: "Describe a happy event in your childhood",
        ragExamples: [],
      });
    });
    expect(searchTeacherCases).not.toHaveBeenCalled();
  });

  it("injects Zhipu-backed teacher case matches into the grading request", async () => {
    vi.mocked(gradeSpeaking).mockResolvedValue(mockGradeResult);
    vi.mocked(searchTeacherCases).mockResolvedValue([
      {
        case: {
          id: "case-1",
          originalText: "I like travel.",
          revisedText: "I am fond of travelling.",
          teacherComment: "替换重复表达。",
          scoringPreference: "重视自然表达。",
          embeddingStatus: "ready",
          createdAt: "1",
          updatedAt: "1",
        },
        score: 0.91,
      },
    ]);
    render(<GradingPage config={{ ...configuredConfig, zhipu: { ...configuredConfig.zhipu, apiKeyConfigured: true } }} serviceReady />);

    fireEvent.change(screen.getByLabelText("学生回答文本"), {
      target: { value: "This is a long enough speaking answer about travelling with friends." },
    });
    fireEvent.click(screen.getByRole("button", { name: /生成批改报告/ }));

    await waitFor(() => {
      expect(searchTeacherCases).toHaveBeenCalledWith(
        "This is a long enough speaking answer about travelling with friends.",
        3,
      );
    });
    expect(gradeSpeaking).toHaveBeenCalledWith({
      text: "This is a long enough speaking answer about travelling with friends.",
      part: "part2",
      question: "Describe a happy event in your childhood",
      ragExamples: [
        {
          originalText: "I like travel.",
          revisedText: "I am fond of travelling.",
          teacherComment: "替换重复表达。",
          scoringPreference: "重视自然表达。",
        },
      ],
    });
  });
});
