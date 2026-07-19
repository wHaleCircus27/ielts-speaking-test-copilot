import { invokeCommand } from "./tauri";
import type { RagReference } from "../app/workspaceTypes";
import type {
  TeacherCase,
  TeacherCaseInput,
  TeacherCaseMatch,
  TeacherCaseSearchDiagnostics,
} from "../types/corpus";
import type { RagPromptExample } from "../types/grading";

export function createTeacherCase(input: TeacherCaseInput) {
  return invokeCommand<TeacherCase>("create_teacher_case", { input });
}

export function listTeacherCases() {
  return invokeCommand<TeacherCase[]>("list_teacher_cases");
}

export function updateTeacherCase(id: string, input: TeacherCaseInput) {
  return invokeCommand<TeacherCase>("update_teacher_case", { id, input });
}

export function deleteTeacherCase(id: string) {
  return invokeCommand<void>("delete_teacher_case", { id });
}

export function rebuildTeacherCaseEmbedding(id: string) {
  return invokeCommand<TeacherCase>("rebuild_teacher_case_embedding", { id });
}

export function searchTeacherCases(queryText: string, topK: number) {
  return invokeCommand<TeacherCaseMatch[]>("search_teacher_cases", {
    queryText,
    topK,
  });
}

export function diagnoseTeacherCaseSearch(
  queryText: string,
  topK: number,
  thresholdOverride?: number,
) {
  return invokeCommand<TeacherCaseSearchDiagnostics>(
    "diagnose_teacher_case_search",
    {
      queryText,
      topK,
      thresholdOverride,
    },
  );
}

export function mapTeacherCaseMatchesToRagExamples(
  matches: TeacherCaseMatch[],
): RagPromptExample[] {
  return matches.slice(0, 3).map((match) => ({
    originalText: match.case.originalText,
    revisedText: match.case.revisedText,
    teacherComment: match.case.teacherComment,
    scoringPreference: match.case.scoringPreference,
    score: Number.isFinite(match.score) ? match.score : undefined,
  }));
}

export function buildTeacherCaseSearchQuery(question: string, answer: string) {
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  if (normalizedQuestion && normalizedAnswer) {
    return `Question: ${normalizedQuestion}\nAnswer: ${normalizedAnswer}`;
  }
  return normalizedAnswer || normalizedQuestion;
}

export function mapTeacherCaseMatchesToRagReferences(
  matches: TeacherCaseMatch[],
): RagReference[] {
  return matches.slice(0, 3).map((match) => ({
    caseId: match.case.id,
    score: match.score,
    originalText: match.case.originalText,
    revisedText: match.case.revisedText,
    teacherComment: match.case.teacherComment,
    scoringPreference: match.case.scoringPreference,
  }));
}
