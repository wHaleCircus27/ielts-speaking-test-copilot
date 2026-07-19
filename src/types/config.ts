export type ThemeId = "theme-claude" | "theme-animal" | "theme-glass";

export type DeepSeekModel =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "deepseek-chat"
  | "deepseek-reasoner";

export type FontPreference = "system" | "serif" | "space" | "mono";

export type FontSizePreference = "small" | "medium" | "large";

export const ZHIPU_EMBEDDING_DIMENSIONS = 1024 as const;

export type ZhipuEmbeddingDimensions = typeof ZHIPU_EMBEDDING_DIMENSIONS;

export type CredentialStatus = "configured" | "bindingMismatch" | "missing";

export type PublicAppConfig = {
  schemaVersion: 2;
  theme: ThemeId;
  typography: {
    font: FontPreference;
    fontSize: FontSizePreference;
  };
  deepseek: {
    apiKeyConfigured: boolean;
    credentialStatus: CredentialStatus;
    enabled: boolean;
    baseUrl: string;
    model: DeepSeekModel;
    allowInsecureLocalhost: boolean;
  };
  zhipu: {
    apiKeyConfigured: boolean;
    credentialStatus: CredentialStatus;
    enabled: boolean;
    baseUrl: string;
    model: string;
    dimensions: ZhipuEmbeddingDimensions;
    similarityThreshold: number;
    allowInsecureLocalhost: boolean;
  };
  azure: {
    keyConfigured: boolean;
    credentialStatus: CredentialStatus;
    enabled: boolean;
    region: string;
    language: string;
  };
  disclosure: {
    latestVersion: 1;
    acceptedVersion?: number;
    noticeRequired: boolean;
  };
};

export type SaveAppConfigInput = {
  theme: ThemeId;
  typography: {
    font: FontPreference;
    fontSize: FontSizePreference;
  };
  deepseek: {
    apiKey?: string;
    enabled: boolean;
    baseUrl: string;
    model: DeepSeekModel;
    allowInsecureLocalhost: boolean;
  };
  zhipu: {
    apiKey?: string;
    enabled: boolean;
    baseUrl: string;
    model: string;
    dimensions: ZhipuEmbeddingDimensions;
    similarityThreshold?: number;
    allowInsecureLocalhost: boolean;
  };
  azure: {
    key?: string;
    enabled: boolean;
    region: string;
    language: string;
  };
};

export const defaultPublicConfig: PublicAppConfig = {
  schemaVersion: 2,
  theme: "theme-claude",
  typography: {
    font: "system",
    fontSize: "medium",
  },
  deepseek: {
    apiKeyConfigured: false,
    credentialStatus: "missing",
    enabled: false,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    allowInsecureLocalhost: false,
  },
  zhipu: {
    apiKeyConfigured: false,
    credentialStatus: "missing",
    enabled: false,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "embedding-3",
    dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
    similarityThreshold: 0.45,
    allowInsecureLocalhost: false,
  },
  azure: {
    keyConfigured: false,
    credentialStatus: "missing",
    enabled: false,
    region: "",
    language: "en-US",
  },
  disclosure: {
    latestVersion: 1,
    noticeRequired: true,
  },
};
