export type ThemeId = "theme-claude" | "theme-animal" | "theme-glass";

export type DeepSeekModel = "deepseek-chat" | "deepseek-reasoner";

export type PublicAppConfig = {
  theme: ThemeId;
  deepseek: {
    apiKeyConfigured: boolean;
    baseUrl: string;
    model: DeepSeekModel;
  };
  azure: {
    keyConfigured: boolean;
    region: string;
    language: string;
  };
};

export type SaveAppConfigInput = {
  theme: ThemeId;
  deepseek: {
    apiKey?: string;
    baseUrl: string;
    model: DeepSeekModel;
  };
  azure: {
    key?: string;
    region: string;
    language: string;
  };
};

export const defaultPublicConfig: PublicAppConfig = {
  theme: "theme-claude",
  deepseek: {
    apiKeyConfigured: false,
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  azure: {
    keyConfigured: false,
    region: "",
    language: "en-US",
  },
};
