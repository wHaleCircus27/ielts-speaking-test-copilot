import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorpusPage } from "./CorpusPage";
import {
  createTeacherCase,
  deleteTeacherCase,
  diagnoseTeacherCaseSearch,
  listTeacherCases,
  rebuildTeacherCaseEmbedding,
  updateTeacherCase,
} from "../../lib/corpus";
import type { TeacherCase } from "../../types/corpus";

vi.mock("../../lib/corpus", () => ({
  createTeacherCase: vi.fn(),
  deleteTeacherCase: vi.fn(),
  diagnoseTeacherCaseSearch: vi.fn(),
  listTeacherCases: vi.fn(),
  rebuildTeacherCaseEmbedding: vi.fn(),
  updateTeacherCase: vi.fn(),
}));

const firstTeacherCase: TeacherCase = {
  id: "case-1",
  originalText: "I like English because it is useful.",
  revisedText:
    "I enjoy learning English because it helps me communicate clearly.",
  teacherComment: "表达清楚，但需要更多具体细节。",
  scoringPreference: "更重视自然连接。",
  embeddingStatus: "pending",
  createdAt: "1710000000000",
  updatedAt: "1710000000000",
};

describe("CorpusPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTeacherCases).mockResolvedValue([]);
    vi.mocked(createTeacherCase).mockResolvedValue(firstTeacherCase);
    vi.mocked(updateTeacherCase).mockResolvedValue({
      ...firstTeacherCase,
      originalText: "I really enjoy English classes.",
    });
    vi.mocked(deleteTeacherCase).mockResolvedValue(undefined);
    vi.mocked(rebuildTeacherCaseEmbedding).mockRejectedValue({
      code: "ZHIPU_KEY_MISSING",
      message: "请先在设置页配置智谱 API Key。",
    });
    vi.mocked(diagnoseTeacherCaseSearch).mockResolvedValue({
      threshold: 0.45,
      topK: 3,
      readyCandidateCount: 0,
      matchedCount: 0,
      belowThresholdCount: 0,
      embeddingSource: "network",
      durationMs: 12,
      included: [],
      nearMisses: [],
    });
  });

  it("creates a teacher case and refreshes the SQLite-backed list", async () => {
    vi.mocked(listTeacherCases)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([firstTeacherCase]);

    render(<CorpusPage />);

    await waitFor(() => {
      expect(screen.getByText(/还没有教师案例/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("学生原始文本"), {
      target: { value: " I like English because it is useful. " },
    });
    fireEvent.change(screen.getByLabelText("教师修改后文本"), {
      target: {
        value:
          " I enjoy learning English because it helps me communicate clearly. ",
      },
    });
    fireEvent.change(screen.getByLabelText("教师评语"), {
      target: { value: " 表达清楚，但需要更多具体细节。 " },
    });
    fireEvent.change(screen.getByPlaceholderText(/更重视自然连接/), {
      target: { value: " 更重视自然连接。 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存案例" }));

    await waitFor(() => {
      expect(
        screen.getByText("教师案例已保存，Embedding 状态为 pending。"),
      ).toBeInTheDocument();
    });

    expect(createTeacherCase).toHaveBeenCalledWith({
      originalText: "I like English because it is useful.",
      revisedText:
        "I enjoy learning English because it helps me communicate clearly.",
      teacherComment: "表达清楚，但需要更多具体细节。",
      scoringPreference: "更重视自然连接。",
    });
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("edits and deletes one teacher case without batch delete behavior", async () => {
    vi.mocked(listTeacherCases)
      .mockResolvedValueOnce([firstTeacherCase])
      .mockResolvedValueOnce([
        {
          ...firstTeacherCase,
          originalText: "I really enjoy English classes.",
        },
      ])
      .mockResolvedValueOnce([]);

    render(<CorpusPage />);

    await waitFor(() => {
      expect(
        screen.getByText("I like English because it is useful."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("学生原始文本"), {
      target: { value: "I really enjoy English classes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(
        screen.getByText("教师案例已更新，Embedding 状态为 pending。"),
      ).toBeInTheDocument();
    });

    expect(updateTeacherCase).toHaveBeenCalledWith(
      "case-1",
      expect.objectContaining({
        originalText: "I really enjoy English classes.",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.getByText("教师案例已删除。")).toBeInTheDocument();
    });

    expect(deleteTeacherCase).toHaveBeenCalledTimes(1);
    expect(deleteTeacherCase).toHaveBeenCalledWith("case-1");
  });

  it("shows Zhipu key missing when rebuilding a teacher case vector without configuration", async () => {
    vi.mocked(listTeacherCases).mockResolvedValueOnce([firstTeacherCase]);

    render(<CorpusPage />);

    await waitFor(() => {
      expect(
        screen.getByText("I like English because it is useful."),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "重建 Embedding" }));

    await waitFor(() => {
      expect(screen.getByText("教师案例库操作失败")).toBeInTheDocument();
    });

    expect(
      screen.getByText("请先在设置页配置智谱 API Key。"),
    ).toBeInTheDocument();
    expect(rebuildTeacherCaseEmbedding).toHaveBeenCalledWith("case-1");
  });

  it("shows embedding failure reason for failed teacher cases", async () => {
    vi.mocked(listTeacherCases).mockResolvedValueOnce([
      {
        ...firstTeacherCase,
        embeddingStatus: "failed",
        embeddingError: "智谱 Embedding 服务返回错误状态：429。",
      },
    ]);

    render(<CorpusPage />);

    await waitFor(() => {
      expect(
        screen.getByText("智谱 Embedding 服务返回错误状态：429。"),
      ).toBeInTheDocument();
    });
  });

  it("previews teacher case search results with similarity scores", async () => {
    vi.mocked(listTeacherCases).mockResolvedValueOnce([firstTeacherCase]);
    vi.mocked(diagnoseTeacherCaseSearch).mockResolvedValueOnce({
      threshold: 0.45,
      topK: 3,
      readyCandidateCount: 2,
      matchedCount: 1,
      belowThresholdCount: 1,
      embeddingSource: "cache",
      durationMs: 7,
      included: [
        {
          case: firstTeacherCase,
          score: 0.91,
        },
      ],
      nearMisses: [
        {
          case: {
            ...firstTeacherCase,
            id: "case-2",
            originalText: "I prefer reading at home.",
          },
          score: 0.42,
        },
      ],
    });

    render(<CorpusPage />);

    await waitFor(() => {
      expect(
        screen.getByText("I like English because it is useful."),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("教师案例搜索预览"), {
      target: {
        value: "Question: travel\nAnswer: I like travelling with friends.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "检索 Top-K" }));

    await waitFor(() => {
      expect(diagnoseTeacherCaseSearch).toHaveBeenCalledWith(
        "Question: travel\nAnswer: I like travelling with friends.",
        3,
      );
    });
    expect(screen.getByText("0.91")).toBeInTheDocument();
    expect(screen.getByText(/阈值 0.45/)).toBeInTheDocument();
    expect(screen.getByText(/缓存命中/)).toBeInTheDocument();
    expect(screen.getByText("低于阈值的 near misses")).toBeInTheDocument();
    expect(screen.getByText("0.42")).toBeInTheDocument();
  });

  it("rebuilds pending and failed teacher cases sequentially from the maintenance queue", async () => {
    const failedTeacherCase: TeacherCase = {
      ...firstTeacherCase,
      id: "case-2",
      originalText: "I need more practice.",
      embeddingStatus: "failed",
      embeddingError: "timeout",
    };
    vi.mocked(listTeacherCases)
      .mockResolvedValueOnce([firstTeacherCase, failedTeacherCase])
      .mockResolvedValueOnce([
        { ...firstTeacherCase, embeddingStatus: "ready" },
        { ...failedTeacherCase, embeddingStatus: "failed" },
      ]);
    vi.mocked(rebuildTeacherCaseEmbedding)
      .mockResolvedValueOnce({ ...firstTeacherCase, embeddingStatus: "ready" })
      .mockRejectedValueOnce({
        code: "ZHIPU_EMBEDDING_HTTP_ERROR",
        message: "智谱 Embedding 服务返回错误状态：500。",
      });

    render(<CorpusPage />);

    await waitFor(() => {
      expect(
        screen.getByText("I like English because it is useful."),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "重建 pending/failed" }),
    );

    await waitFor(() => {
      expect(rebuildTeacherCaseEmbedding).toHaveBeenNthCalledWith(1, "case-1");
      expect(rebuildTeacherCaseEmbedding).toHaveBeenNthCalledWith(2, "case-2");
    });
    await waitFor(() => {
      expect(
        screen.getByText("pending/failed 重建队列完成：1/2 条成功，1 条失败。"),
      ).toBeInTheDocument();
    });
  });
});
