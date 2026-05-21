import { describe, expect, it } from "vitest";
import { normalizeTauriError } from "./tauri";

describe("normalizeTauriError", () => {
  it("keeps structured app errors", () => {
    expect(normalizeTauriError({ code: "CONFIG_READ_FAILED", message: "读取失败" })).toEqual({
      code: "CONFIG_READ_FAILED",
      message: "读取失败",
    });
  });

  it("wraps string errors", () => {
    expect(normalizeTauriError("command failed")).toEqual({
      code: "TAURI_COMMAND_ERROR",
      message: "command failed",
    });
  });

  it("wraps unknown errors", () => {
    expect(normalizeTauriError(new Error("boom"))).toEqual({
      code: "UNKNOWN_ERROR",
      message: "操作失败，请稍后重试。",
      detail: "boom",
    });
  });
});
