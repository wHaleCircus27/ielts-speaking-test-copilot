export type ThemeId = "theme-claude" | "theme-animal" | "theme-glass";

export type DeepSeekModel =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "deepseek-chat"
  | "deepseek-reasoner";

export type FontPreference = "system" | "serif" | "space" | "mono";

export type FontSizePreference = "small" | "medium" | "large";

export type ZhipuEmbeddingDimensions = 2048;

export type PublicAppConfig = {
  theme: ThemeId;
  typography: {
    font: FontPreference;
    fontSize: FontSizePreference;
  };
  deepseek: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: DeepSeekModel;
  };
  zhipu: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: string;
    dimensions: ZhipuEmbeddingDimensions;
  };
  azure: {
    keyConfigured: boolean;
    region: string;
    language: string;
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
    baseUrl: string;
    model: DeepSeekModel;
  };
  zhipu: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    dimensions: ZhipuEmbeddingDimensions;
  };
  azure: {
    key?: string;
    region: string;
    language: string;
  };
};

export const defaultPublicConfig: PublicAppConfig = {
  theme: "theme-claude",
  typography: {
    font: "system",
    fontSize: "medium",
  },
  deepseek: {
    apiKeyConfigured: false,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  zhipu: {
    apiKeyConfigured: false,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "embedding-3",
    dimensions: 2048,
  },
  azure: {
    keyConfigured: false,
    region: "",
    language: "en-US",
  },
};
