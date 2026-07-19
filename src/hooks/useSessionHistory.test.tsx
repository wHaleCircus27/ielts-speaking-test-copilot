import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AddCorrectionRecordInput,
  WorkspaceResult,
} from "../app/workspaceTypes";
import { useSessionHistory } from "./useSessionHistory";

vi.mock("../lib/media", () => ({
  deleteGeneratedMediaFile: vi.fn(),
  reconcileGeneratedMedia: vi.fn().mockResolvedValue({
    removedFiles: 0,
    removedBytes: 0,
    totalBytes: 0,
    capacityBytes: 2 * 1024 * 1024 * 1024,
  }),
}));

const storedWorkspaceResult: WorkspaceResult = {
  overallScore: 7,
  fluencyScore: { score: 7, feedback: "", strengths: [], improvements: [] },
  lexicalScore: { score: 7, feedback: "", strengths: [], improvements: [] },
  grammarScore: { score: 7, feedback: "", strengths: [], improvements: [] },
  pronunciationScore: {
    score: 7,
    feedback: "",
    strengths: [],
    improvements: [],
  },
  keyCorrections: [],
  generalFeedback: "Stored feedback",
  modelAnswer: "Stored model answer",
  transcript: [],
};

describe("useSessionHistory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists every record when two completions arrive before React rerenders", () => {
    const { result } = renderHook(() => useSessionHistory());
    const firstRecord: AddCorrectionRecordInput = {
      title: "First completion",
      fileName: "first.txt",
      result: storedWorkspaceResult,
    };
    const secondRecord: AddCorrectionRecordInput = {
      title: "Second completion",
      fileName: "second.wav",
      result: storedWorkspaceResult,
      audioPath:
        "/controlled/generated-media/11111111-1111-4111-8111-111111111111.wav",
    };

    act(() => {
      result.current.addRecord(firstRecord);
      result.current.addRecord(secondRecord);
    });

    expect(result.current.records.map((record) => record.title)).toEqual([
      "Second completion",
      "First completion",
    ]);
    const storedRecords = JSON.parse(
      window.localStorage.getItem("ielts_copilot_correction_records") ?? "[]",
    ) as Array<{ title: string }>;
    expect(storedRecords.map((record) => record.title)).toEqual([
      "Second completion",
      "First completion",
    ]);
  });
});
