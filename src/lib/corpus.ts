import { invokeCommand } from "./tauri";
import type { TeacherCase, TeacherCaseInput } from "../types/corpus";

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
