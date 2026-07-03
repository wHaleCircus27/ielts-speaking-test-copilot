import { describe, expect, it } from "vitest";
import {
  buildTeacherCaseSearchQuery,
  mapTeacherCaseMatchesToRagExamples,
  mapTeacherCaseMatchesToRagReferences,
} from "./corpus";
import type { TeacherCaseMatch } from "../types/corpus";

const teacherCaseMatches: TeacherCaseMatch[] = [
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
    score: 0.91234,
  },
];

describe("corpus RAG helpers", () => {
  it("builds teacher case search query from question and answer", () => {
    expect(buildTeacherCaseSearchQuery(" Describe a trip ", " I went to Paris. ")).toBe(
      "Question: Describe a trip\nAnswer: I went to Paris.",
    );
    expect(buildTeacherCaseSearchQuery(" ", " I went to Paris. ")).toBe("I went to Paris.");
  });

  it("maps teacher case matches to prompt examples with scores", () => {
    expect(mapTeacherCaseMatchesToRagExamples(teacherCaseMatches)).toEqual([
      {
        originalText: "I like travel.",
        revisedText: "I am fond of travelling.",
        teacherComment: "替换重复表达。",
        scoringPreference: "重视自然表达。",
        score: 0.91234,
      },
    ]);
  });

  it("maps teacher case matches to workspace references", () => {
    expect(mapTeacherCaseMatchesToRagReferences(teacherCaseMatches)).toEqual([
      {
        caseId: "case-1",
        originalText: "I like travel.",
        revisedText: "I am fond of travelling.",
        teacherComment: "替换重复表达。",
        scoringPreference: "重视自然表达。",
        score: 0.91234,
      },
    ]);
  });
});
