import { invokeCommand } from "./tauri";
import type { ConfigValidationResult, GradeRequest, GradeResult } from "../types/grading";

export function validateDeepSeekConfig() {
  return invokeCommand<ConfigValidationResult>("validate_deepseek_config");
}

export function gradeSpeaking(request: GradeRequest) {
  return invokeCommand<GradeResult>("grade_speaking", { request });
}
