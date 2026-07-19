import { invokeCommand } from "./tauri";
import type {
  ConfigValidationResult,
  GradeRequest,
  GradeResult,
} from "../types/grading";

function isTauriRuntimeAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function validateDeepSeekConfig() {
  if (!isTauriRuntimeAvailable()) {
    return Promise.resolve<ConfigValidationResult>({
      ok: false,
      apiKeyConfigured: false,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      serviceReachable: false,
      availableModels: [],
      message: "DeepSeek 连通性测试需要在 Tauri 桌面端运行。",
    });
  }

  return invokeCommand<ConfigValidationResult>("validate_deepseek_config");
}

export function gradeSpeaking(request: GradeRequest) {
  return invokeCommand<GradeResult>("grade_speaking", { request });
}
