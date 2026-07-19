import { invokeCommand } from "./tauri";
import {
  defaultPublicConfig,
  ZHIPU_EMBEDDING_DIMENSIONS,
  type PublicAppConfig,
  type SaveAppConfigInput,
} from "../types/config";

const browserPreviewConfigStorageKey =
  "ielts-speaking-test-copilot.preview-config";

function isTauriRuntimeAvailable() {
  return "__TAURI_INTERNALS__" in window;
}

function readBrowserPreviewConfig(): PublicAppConfig {
  const storedConfig = window.localStorage.getItem(
    browserPreviewConfigStorageKey,
  );
  if (!storedConfig) {
    return defaultPublicConfig;
  }

  try {
    const parsedConfig = JSON.parse(storedConfig) as PublicAppConfig;
    const legacyCredentialConfigured = Boolean(
      parsedConfig.deepseek?.apiKeyConfigured ||
      parsedConfig.zhipu?.apiKeyConfigured ||
      parsedConfig.azure?.keyConfigured,
    );
    const acceptedDisclosureVersion =
      parsedConfig.disclosure?.acceptedVersion ??
      (legacyCredentialConfigured ? 1 : undefined);
    return {
      schemaVersion: 2,
      theme: parsedConfig.theme ?? defaultPublicConfig.theme,
      typography: {
        font:
          parsedConfig.typography?.font ?? defaultPublicConfig.typography.font,
        fontSize:
          parsedConfig.typography?.fontSize ??
          defaultPublicConfig.typography.fontSize,
      },
      deepseek: {
        apiKeyConfigured: Boolean(parsedConfig.deepseek?.apiKeyConfigured),
        credentialStatus: parsedConfig.deepseek?.apiKeyConfigured
          ? "configured"
          : (parsedConfig.deepseek?.credentialStatus ?? "missing"),
        enabled:
          typeof parsedConfig.deepseek?.enabled === "boolean"
            ? parsedConfig.deepseek.enabled
            : Boolean(parsedConfig.deepseek?.apiKeyConfigured),
        baseUrl:
          parsedConfig.deepseek?.baseUrl ??
          defaultPublicConfig.deepseek.baseUrl,
        model:
          parsedConfig.deepseek?.model ?? defaultPublicConfig.deepseek.model,
        allowInsecureLocalhost: Boolean(
          parsedConfig.deepseek?.allowInsecureLocalhost,
        ),
      },
      zhipu: {
        apiKeyConfigured: Boolean(parsedConfig.zhipu?.apiKeyConfigured),
        credentialStatus: parsedConfig.zhipu?.apiKeyConfigured
          ? "configured"
          : (parsedConfig.zhipu?.credentialStatus ?? "missing"),
        enabled:
          typeof parsedConfig.zhipu?.enabled === "boolean"
            ? parsedConfig.zhipu.enabled
            : Boolean(parsedConfig.zhipu?.apiKeyConfigured),
        baseUrl:
          parsedConfig.zhipu?.baseUrl ?? defaultPublicConfig.zhipu.baseUrl,
        model: parsedConfig.zhipu?.model ?? defaultPublicConfig.zhipu.model,
        dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
        similarityThreshold:
          typeof parsedConfig.zhipu?.similarityThreshold === "number"
            ? parsedConfig.zhipu.similarityThreshold
            : defaultPublicConfig.zhipu.similarityThreshold,
        allowInsecureLocalhost: Boolean(
          parsedConfig.zhipu?.allowInsecureLocalhost,
        ),
      },
      azure: {
        keyConfigured: Boolean(parsedConfig.azure?.keyConfigured),
        credentialStatus: parsedConfig.azure?.keyConfigured
          ? "configured"
          : (parsedConfig.azure?.credentialStatus ?? "missing"),
        enabled:
          typeof parsedConfig.azure?.enabled === "boolean"
            ? parsedConfig.azure.enabled
            : Boolean(parsedConfig.azure?.keyConfigured),
        region: parsedConfig.azure?.region ?? defaultPublicConfig.azure.region,
        language:
          parsedConfig.azure?.language ?? defaultPublicConfig.azure.language,
      },
      disclosure: {
        latestVersion: 1,
        acceptedVersion: acceptedDisclosureVersion,
        noticeRequired:
          parsedConfig.disclosure?.noticeRequired ??
          (legacyCredentialConfigured || acceptedDisclosureVersion !== 1),
      },
    };
  } catch {
    window.localStorage.removeItem(browserPreviewConfigStorageKey);
    return defaultPublicConfig;
  }
}

function writeBrowserPreviewConfig(config: PublicAppConfig) {
  window.localStorage.setItem(
    browserPreviewConfigStorageKey,
    JSON.stringify(config),
  );
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
      schemaVersion: 2,
      theme: input.theme,
      typography: {
        font: input.typography.font,
        fontSize: input.typography.fontSize,
      },
      deepseek: {
        apiKeyConfigured:
          Boolean(input.deepseek.apiKey?.trim()) ||
          currentConfig.deepseek.apiKeyConfigured,
        credentialStatus:
          Boolean(input.deepseek.apiKey?.trim()) ||
          currentConfig.deepseek.apiKeyConfigured
            ? "configured"
            : "missing",
        enabled: input.deepseek.enabled,
        baseUrl: input.deepseek.baseUrl.trim(),
        model: input.deepseek.model,
        allowInsecureLocalhost: input.deepseek.allowInsecureLocalhost,
      },
      zhipu: {
        apiKeyConfigured:
          Boolean(input.zhipu.apiKey?.trim()) ||
          currentConfig.zhipu.apiKeyConfigured,
        credentialStatus:
          Boolean(input.zhipu.apiKey?.trim()) ||
          currentConfig.zhipu.apiKeyConfigured
            ? "configured"
            : "missing",
        enabled: input.zhipu.enabled,
        baseUrl: input.zhipu.baseUrl.trim(),
        model: input.zhipu.model.trim(),
        dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
        similarityThreshold:
          input.zhipu.similarityThreshold ??
          currentConfig.zhipu.similarityThreshold ??
          defaultPublicConfig.zhipu.similarityThreshold,
        allowInsecureLocalhost: input.zhipu.allowInsecureLocalhost,
      },
      azure: {
        keyConfigured:
          Boolean(input.azure.key?.trim()) || currentConfig.azure.keyConfigured,
        credentialStatus:
          Boolean(input.azure.key?.trim()) || currentConfig.azure.keyConfigured
            ? "configured"
            : "missing",
        enabled: input.azure.enabled,
        region: input.azure.region.trim(),
        language: input.azure.language.trim(),
      },
      disclosure: currentConfig.disclosure,
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
        credentialStatus: "missing",
        enabled: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("clear_deepseek_key");
}

export function clearZhipuKey() {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      ...currentConfig,
      zhipu: {
        ...currentConfig.zhipu,
        apiKeyConfigured: false,
        credentialStatus: "missing",
        enabled: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("clear_zhipu_key");
}

export function clearAzureKey() {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      ...currentConfig,
      azure: {
        ...currentConfig.azure,
        keyConfigured: false,
        credentialStatus: "missing",
        enabled: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("clear_azure_key");
}

export function acceptCloudDisclosure(version = 1) {
  if (!isTauriRuntimeAvailable()) {
    const currentConfig = readBrowserPreviewConfig();
    const nextConfig: PublicAppConfig = {
      ...currentConfig,
      disclosure: {
        latestVersion: 1,
        acceptedVersion: version,
        noticeRequired: false,
      },
    };
    writeBrowserPreviewConfig(nextConfig);
    return Promise.resolve(nextConfig);
  }

  return invokeCommand<PublicAppConfig>("accept_cloud_disclosure", { version });
}
