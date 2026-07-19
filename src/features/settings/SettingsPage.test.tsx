import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import {
  acceptCloudDisclosure,
  clearAzureKey,
  clearDeepSeekKey,
  clearZhipuKey,
  saveAppConfig,
} from "../../lib/config";
import { validateDeepSeekConfig } from "../../lib/grading";
import {
  defaultPublicConfig,
  ZHIPU_EMBEDDING_DIMENSIONS,
} from "../../types/config";

vi.mock("../../lib/config", () => ({
  acceptCloudDisclosure: vi.fn(),
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
    vi.mocked(acceptCloudDisclosure).mockResolvedValue({
      ...defaultPublicConfig,
      disclosure: {
        latestVersion: 1,
        acceptedVersion: 1,
        noticeRequired: false,
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

    expect(screen.getByLabelText("向量维度")).toHaveValue(
      String(ZHIPU_EMBEDDING_DIMENSIONS),
    );

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

  it("requires explicit disclosure acceptance before enabling a cloud service", async () => {
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
    expect(screen.getByText(/DeepSeek 会接收题目、Part/)).toBeInTheDocument();
    expect(
      screen.getByText(/停用服务只会阻止新的网络请求/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("启用 DeepSeek 云端批改"));
    fireEvent.click(screen.getByRole("button", { name: "完成并应用" }));

    expect(
      await screen.findByText("启用云服务前，请确认已阅读并接受数据流说明。"),
    ).toBeInTheDocument();
    expect(saveAppConfig).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/我已阅读并接受版本 1/));
    fireEvent.click(screen.getByRole("button", { name: "完成并应用" }));

    await waitFor(() => {
      expect(acceptCloudDisclosure).toHaveBeenCalledWith(1);
      expect(saveAppConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          deepseek: expect.objectContaining({ enabled: true }),
        }),
      );
    });
  });

  it("disables configuration and service actions while saving", async () => {
    let finishSaving: (() => void) | undefined;
    const pendingSave = new Promise<typeof defaultPublicConfig>((resolve) => {
      finishSaving = () => resolve(defaultPublicConfig);
    });
    vi.mocked(saveAppConfig).mockReturnValueOnce(pendingSave);
    const onSaved = vi.fn();
    const { container } = render(
      <SettingsPage
        config={defaultPublicConfig}
        onClose={vi.fn()}
        onConfigChange={vi.fn()}
        onSaved={onSaved}
        onThemePreview={vi.fn()}
        onTypographyPreview={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 引擎模型" }));
    fireEvent.click(screen.getByRole("button", { name: "完成并应用" }));

    await waitFor(() => {
      expect(saveAppConfig).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "保存中" })).toBeDisabled();
    });

    const settingsForm = container.querySelector("#app-settings-form");
    expect(settingsForm).toHaveAttribute("aria-busy", "true");
    settingsForm
      ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
      .forEach((configurationControl) => {
        expect(configurationControl).toBeDisabled();
      });

    const serviceActionNames = [
      "测试 DeepSeek 连接",
      "清除 DeepSeek Key",
      "清除智谱 Key",
      "清除 Azure Key",
    ];
    serviceActionNames.forEach((serviceActionName) => {
      expect(
        screen.getByRole("button", { name: serviceActionName }),
      ).toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "测试 DeepSeek 连接" }));
    fireEvent.click(screen.getByRole("button", { name: "清除 DeepSeek Key" }));
    expect(validateDeepSeekConfig).not.toHaveBeenCalled();
    expect(clearDeepSeekKey).not.toHaveBeenCalled();
    expect(clearZhipuKey).not.toHaveBeenCalled();
    expect(clearAzureKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "外观主题" }));
    expect(
      screen.getByRole("button", { name: /Claude \(古典雅致\)/ }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "字体与字号" }));
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /标准 \(Default\)/ }),
    ).toBeDisabled();

    finishSaving?.();
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });
});
