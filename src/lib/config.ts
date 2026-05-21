import { invokeCommand } from "./tauri";
import { defaultPublicConfig, type PublicAppConfig, type SaveAppConfigInput } from "../types/config";

const browserPreviewConfigStorageKey = "ielts-speaking-test-copilot.preview-config";

function isTauriRuntimeAvailable() {
  return "__TAURI_INTERNALS__" in window;
}

function readBrowserPreviewConfig(): PublicAppConfig {
  const storedConfig = window.localStorage.getItem(browserPreviewConfigStorageKey);
  if (!storedConfig) {
    return defaultPublicConfig;
  }

  try {
    const parsedConfig = JSON.parse(storedConfig) as PublicAppConfig;
    return {
      theme: parsedConfig.theme ?? defaultPublicConfig.theme,
      typography: {
        font: parsedConfig.typography?.font ?? defaultPublicConfig.typography.font,
        fontSize: parsedConfig.typography?.fontSize ?? defaultPublicConfig.typography.fontSize,
      },
      deepseek: {
        apiKeyConfigured: Boolean(parsedConfig.deepseek?.apiKeyConfigured),
        baseUrl: parsedConfig.deepseek?.baseUrl ?? defaultPublicConfig.deepseek.baseUrl,
        model: parsedConfig.deepseek?.model ?? defaultPublicConfig.deepseek.model,
      },
      azure: {
        keyConfigured: Boolean(parsedConfig.azure?.keyConfigured),
        region: parsedConfig.azure?.region ?? defaultPublicConfig.azure.region,
        language: parsedConfig.azure?.language ?? defaultPublicConfig.azure.language,
      },
    };
  } catch {
    window.localStorage.removeItem(browserPreviewConfigStorageKey);
    return defaultPublicConfig;
  }
}

function writeBrowserPreviewConfig(config: PublicAppConfig) {
  window.localStorage.setItem(browserPreviewConfigStorageKey, JSON.stringify(config));
}

export function getAppConfig() {
  if (!isTauriRuntimeAvailable()) {
    return Promise.resolve(readBrowserPreviewConfig());
  }

  return invokeCommand<PublicAppConfig>("get_app_config");
}

export function saveAppConfig(input: SaveAppConfigInput) {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      theme: input.theme,
      typography: {
        font: input.typography.font,
        fontSize: input.typography.fontSize,
      },
      deepseek: {
        apiKeyConfigured: Boolean(input.deepseek.apiKey?.trim()) || currentConfig.deepseek.apiKeyConfigured,
        baseUrl: input.deepseek.baseUrl.trim(),
        model: input.deepseek.model,
      },
      azure: {
        keyConfigured: Boolean(input.azure.key?.trim()) || currentConfig.azure.keyConfigured,
        region: input.azure.region.trim(),
        language: input.azure.language.trim(),
      },
    };

    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("save_app_config", { input });
}

export function clearDeepSeekKey() {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      ...currentConfig,
      deepseek: {
        ...currentConfig.deepseek,
        apiKeyConfigured: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("clear_deepseek_key");
}

export function clearAzureKey() {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      ...currentConfig,
      azure: {
        ...currentConfig.azure,
        keyConfigured: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("clear_azure_key");
}
