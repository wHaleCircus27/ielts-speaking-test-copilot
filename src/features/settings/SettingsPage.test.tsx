import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { saveAppConfig } from "../../lib/config";
import { validateDeepSeekConfig } from "../../lib/grading";
import { defaultPublicConfig, ZHIPU_EMBEDDING_DIMENSIONS } from "../../types/config";

vi.mock("../../lib/config", () => ({
  clearAzureKey: vi.fn(),
  clearDeepSeekKey: vi.fn(),
  clearZhipuKey: vi.fn(),
  saveAppConfig: vi.fn(),
}));

vi.mock("../../lib/grading", () => ({
  validateDeepSeekConfig: vi.fn(),
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveAppConfig).mockResolvedValue({
      ...defaultPublicConfig,
      zhipu: {
        ...defaultPublicConfig.zhipu,
        similarityThreshold: 0.62,
      },
    });
    vi.mocked(validateDeepSeekConfig).mockResolvedValue({
      ok: true,
      apiKeyConfigured: true,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      serviceReachable: true,
      availableModels: ["deepseek-v4-flash"],
      message: "DeepSeek 配置可用。",
    });
  });

  it("saves the configurable teacher case RAG similarity threshold", async () => {
    const onConfigChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <SettingsPage
        config={defaultPublicConfig}
        onClose={vi.fn()}
        onConfigChange={onConfigChange}
        onSaved={onSaved}
        onThemePreview={vi.fn()}
        onTypographyPreview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 引擎模型" }));
    fireEvent.change(screen.getByLabelText("RAG 相似度阈值"), {
      target: { value: "0.62" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成并应用" }));

    await waitFor(() => {
      expect(saveAppConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          zhipu: expect.objectContaining({
            similarityThreshold: 0.62,
          }),
        }),
      );
    });
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        zhipu: expect.objectContaining({
          similarityThreshold: 0.62,
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("displays and submits the fixed Zhipu embedding dimensions", async () => {
    render(
      <SettingsPage
        config={defaultPublicConfig}
        onClose={vi.fn()}
        onConfigChange={vi.fn()}
        onSaved={vi.fn()}
        onThemePreview={vi.fn()}
        onTypographyPreview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 引擎模型" }));

    expect(screen.getByLabelText("向量维度")).toHaveValue(String(ZHIPU_EMBEDDING_DIMENSIONS));

    fireEvent.click(screen.getByRole("button", { name: "完成并应用" }));

    await waitFor(() => {
      expect(saveAppConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          zhipu: expect.objectContaining({
            dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
          }),
        }),
      );
    });
  });
});
