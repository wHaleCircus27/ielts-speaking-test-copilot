import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GradingPage } from "./GradingPage";
import { defaultPublicConfig, type PublicAppConfig } from "../../types/config";
import { gradeSpeaking } from "../../lib/grading";

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
});
