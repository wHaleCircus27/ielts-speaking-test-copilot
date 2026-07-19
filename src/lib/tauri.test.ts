import { describe, expect, it } from "vitest";
import { normalizeTauriError } from "./tauri";

describe("normalizeTauriError", () => {
  it("keeps structured app errors", () => {
    expect(
      normalizeTauriError({
        code: "CONFIG_READ_FAILED",
        message: "读取失败",
        status: 503,
        requestId: "request-123",
        detail: "must not cross the frontend boundary",
      }),
    ).toEqual({
      code: "CONFIG_READ_FAILED",
      message: "读取失败",
      status: 503,
      requestId: "request-123",
    });
  });

  it("redacts unstructured string errors", () => {
    expect(
      normalizeTauriError("secret response body and /private/path"),
    ).toEqual({
      code: "TAURI_COMMAND_ERROR",
      message: "本地命令执行失败。",
    });
  });

  it("wraps unknown errors", () => {
    expect(normalizeTauriError(new Error("boom"))).toEqual({
      code: "UNKNOWN_ERROR",
      message: "操作失败，请稍后重试。",
    });
  });
});
