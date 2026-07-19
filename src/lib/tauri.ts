import { invoke } from "@tauri-apps/api/core";
import { isAppError, type AppError } from "../types/errors";

export type HealthCheckResult = {
  ok: true;
  version: string;
  platform: string;
};

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeTauriError(error);
  }
}

export function normalizeTauriError(error: unknown): AppError {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(typeof error.status === "number" ? { status: error.status } : {}),
      ...(typeof error.requestId === "string"
        ? { requestId: error.requestId }
        : {}),
    };
  }

  if (typeof error === "string") {
    return {
      code: "TAURI_COMMAND_ERROR",
      message: "本地命令执行失败。",
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "操作失败，请稍后重试。",
  };
}
