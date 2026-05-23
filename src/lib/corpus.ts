import { invokeCommand } from "./tauri";
import type { TeacherCase, TeacherCaseInput, TeacherCaseMatch } from "../types/corpus";
import type { RagPromptExample } from "../types/grading";

export function createTeacherCase(input: TeacherCaseInput) {
  return invokeCommand<TeacherCase>("create_teacher_case", { input });
}

export function listTeacherCases() {
  return invokeCommand<TeacherCase[]>("list_teacher_cases");
}

export function getTeacherCase(id: string) {
  return invokeCommand<TeacherCase>("get_teacher_case", { id });
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
  return invokeCommand<TeacherCaseMatch[]>("search_teacher_cases", { queryText, topK });
}

export function mapTeacherCaseMatchesToRagExamples(matches: TeacherCaseMatch[]): RagPromptExample[] {
  return matches.slice(0, 3).map((match) => ({
    originalText: match.case.originalText,
    revisedText: match.case.revisedText,
    teacherComment: match.case.teacherComment,
    scoringPreference: match.case.scoringPreference,
  }));
}
