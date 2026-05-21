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
    return error;
  }

  if (typeof error === "string") {
    return {
      code: "TAURI_COMMAND_ERROR",
      message: error,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "操作失败，请稍后重试。",
    detail: error instanceof Error ? error.message : undefined,
  };
}
