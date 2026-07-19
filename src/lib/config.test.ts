import { beforeEach, describe, expect, it } from "vitest";
import { acceptCloudDisclosure, getAppConfig, saveAppConfig } from "./config";
import {
  defaultPublicConfig,
  ZHIPU_EMBEDDING_DIMENSIONS,
  type SaveAppConfigInput,
} from "../types/config";

const browserPreviewConfigStorageKey =
  "ielts-speaking-test-copilot.preview-config";

describe("browser preview app config", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("normalizes stored embedding dimensions to the supported value", async () => {
    window.localStorage.setItem(
      browserPreviewConfigStorageKey,
      JSON.stringify({
        ...defaultPublicConfig,
        zhipu: {
          ...defaultPublicConfig.zhipu,
          dimensions: 2048,
        },
      }),
    );

    const config = await getAppConfig();

    expect(config.zhipu.dimensions).toBe(ZHIPU_EMBEDDING_DIMENSIONS);
  });

  it("ignores forged embedding dimensions when saving", async () => {
    const forgedInput = {
      theme: defaultPublicConfig.theme,
      typography: defaultPublicConfig.typography,
      deepseek: {
        baseUrl: defaultPublicConfig.deepseek.baseUrl,
        model: defaultPublicConfig.deepseek.model,
      },
      zhipu: {
        baseUrl: defaultPublicConfig.zhipu.baseUrl,
        model: defaultPublicConfig.zhipu.model,
        dimensions: 2048,
        similarityThreshold: defaultPublicConfig.zhipu.similarityThreshold,
      },
      azure: {
        region: defaultPublicConfig.azure.region,
        language: defaultPublicConfig.azure.language,
      },
    } as unknown as SaveAppConfigInput;

    const savedConfig = await saveAppConfig(forgedInput);
    const storedConfig = JSON.parse(
      window.localStorage.getItem(browserPreviewConfigStorageKey) ?? "null",
    ) as {
      zhipu: { dimensions: number };
    };

    expect(savedConfig.zhipu.dimensions).toBe(ZHIPU_EMBEDDING_DIMENSIONS);
    expect(storedConfig.zhipu.dimensions).toBe(ZHIPU_EMBEDDING_DIMENSIONS);
  });

  it("preserves legacy configured services and marks disclosure as migrated", async () => {
    window.localStorage.setItem(
      browserPreviewConfigStorageKey,
      JSON.stringify({
        ...defaultPublicConfig,
        schemaVersion: undefined,
        deepseek: {
          apiKeyConfigured: true,
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
        },
        disclosure: undefined,
      }),
    );

    const config = await getAppConfig();

    expect(config.deepseek.enabled).toBe(true);
    expect(config.deepseek.credentialStatus).toBe("configured");
    expect(config.disclosure.acceptedVersion).toBe(1);
    expect(config.disclosure.noticeRequired).toBe(true);
  });

  it("records cloud disclosure acceptance without exposing credentials", async () => {
    const acceptedConfig = await acceptCloudDisclosure(1);

    expect(acceptedConfig.disclosure).toEqual({
      latestVersion: 1,
      acceptedVersion: 1,
      noticeRequired: false,
    });
    const storedConfig = JSON.parse(
      window.localStorage.getItem(browserPreviewConfigStorageKey) ?? "null",
    ) as { deepseek: Record<string, unknown> };
    expect(storedConfig.deepseek).not.toHaveProperty("apiKey");
  });
});
