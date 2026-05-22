import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorpusPage } from "./CorpusPage";
import {
  createTeacherCase,
  deleteTeacherCase,
  listTeacherCases,
  updateTeacherCase,
} from "../../lib/corpus";
import type { TeacherCase } from "../../types/corpus";

vi.mock("../../lib/corpus", () => ({
  createTeacherCase: vi.fn(),
  deleteTeacherCase: vi.fn(),
  listTeacherCases: vi.fn(),
  updateTeacherCase: vi.fn(),
}));

const firstTeacherCase: TeacherCase = {
  id: "case-1",
  originalText: "I like English because it is useful.",
  revisedText: "I enjoy learning English because it helps me communicate clearly.",
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
      target: { value: " I enjoy learning English because it helps me communicate clearly. " },
    });
    fireEvent.change(screen.getByLabelText("教师评语"), {
      target: { value: " 表达清楚，但需要更多具体细节。 " },
    });
    fireEvent.change(screen.getByPlaceholderText(/更重视自然连接/), {
      target: { value: " 更重视自然连接。 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存案例" }));

    await waitFor(() => {
      expect(screen.getByText("教师案例已保存。")).toBeInTheDocument();
    });

    expect(createTeacherCase).toHaveBeenCalledWith({
      originalText: "I like English because it is useful.",
      revisedText: "I enjoy learning English because it helps me communicate clearly.",
      teacherComment: "表达清楚，但需要更多具体细节。",
      scoringPreference: "更重视自然连接。",
    });
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("edits and deletes one teacher case without batch delete behavior", async () => {
    vi.mocked(listTeacherCases)
      .mockResolvedValueOnce([firstTeacherCase])
      .mockResolvedValueOnce([{ ...firstTeacherCase, originalText: "I really enjoy English classes." }])
      .mockResolvedValueOnce([]);

    render(<CorpusPage />);

    await waitFor(() => {
      expect(screen.getByText("I like English because it is useful.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("学生原始文本"), {
      target: { value: "I really enjoy English classes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(screen.getByText("教师案例已更新，Embedding 状态已重置为 pending。")).toBeInTheDocument();
    });

    expect(updateTeacherCase).toHaveBeenCalledWith(
      "case-1",
      expect.objectContaining({ originalText: "I really enjoy English classes." }),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(screen.getByText("教师案例已删除。")).toBeInTheDocument();
    });

    expect(deleteTeacherCase).toHaveBeenCalledTimes(1);
    expect(deleteTeacherCase).toHaveBeenCalledWith("case-1");
  });
});
