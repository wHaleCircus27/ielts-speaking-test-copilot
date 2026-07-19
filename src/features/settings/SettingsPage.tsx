import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Palette,
  ServerCog,
  Sparkles,
  Type as FontIcon,
} from "lucide-react";
import {
  acceptCloudDisclosure,
  clearAzureKey,
  clearDeepSeekKey,
  clearZhipuKey,
  saveAppConfig,
} from "../../lib/config";
import { validateDeepSeekConfig } from "../../lib/grading";
import type {
  FontPreference,
  FontSizePreference,
  PublicAppConfig,
  SaveAppConfigInput,
  ThemeId,
} from "../../types/config";
import { ZHIPU_EMBEDDING_DIMENSIONS } from "../../types/config";
import type { AppError } from "../../types/errors";

type SettingsPageProps = {
  config: PublicAppConfig;
  onClose: () => void;
  onConfigChange: (config: PublicAppConfig) => void;
  onSaved: () => void;
  onTypographyPreview: (typography: PublicAppConfig["typography"]) => void;
  onThemePreview: (theme: ThemeId) => void;
};

export type SettingsPageHandle = {
  submit: () => void;
};

export const SETTINGS_FORM_ID = "app-settings-form";

type SettingsTab = "appearance" | "typography" | "ai";
type ReferenceTheme = "claude" | "animal-crossing" | "liquid-glass";

const themeOptions: Array<{
  id: ThemeId;
  referenceTheme: ReferenceTheme;
  name: string;
  description: string;
}> = [
  {
    id: "theme-claude",
    referenceTheme: "claude",
    name: "Claude (古典雅致)",
    description: "温润沙色，极简沙龙感觉",
  },
  {
    id: "theme-animal",
    referenceTheme: "animal-crossing",
    name: "动森 (自然田园)",
    description: "松绿色调，治愈感叶形",
  },
  {
    id: "theme-glass",
    referenceTheme: "liquid-glass",
    name: "液态玻璃 (赛博暗色)",
    description: "微光冷色，晶莹磨砂霓虹",
  },
];

const tabOptions: Array<{
  id: SettingsTab;
  label: string;
  icon: typeof Palette;
}> = [
  { id: "appearance", label: "外观主题", icon: Palette },
  { id: "typography", label: "字体与字号", icon: FontIcon },
  { id: "ai", label: "AI 引擎模型", icon: Sparkles },
];

const preferredDeepSeekModelOptions: Array<{
  value: SaveAppConfigInput["deepseek"]["model"];
  label: string;
}> = [
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
  { value: "deepseek-v4-pro", label: "deepseek-v4-pro" },
];

function getReferenceTheme(theme: ThemeId): ReferenceTheme {
  if (theme === "theme-glass") {
    return "liquid-glass";
  }
  if (theme === "theme-animal") {
    return "animal-crossing";
  }
  return "claude";
}

function getTabTitle(activeTab: SettingsTab) {
  if (activeTab === "appearance") {
    return "🎨 外观主题设置";
  }
  if (activeTab === "typography") {
    return "🔤 字体与字级设置";
  }
  if (activeTab === "ai") {
    return "🤖 AI 口语批改引擎";
  }
  return "🎨 外观主题设置";
}

function getCredentialStatusLabel(
  credentialStatus: PublicAppConfig["deepseek"]["credentialStatus"],
) {
  if (credentialStatus === "configured") {
    return "Key 已配置";
  }
  if (credentialStatus === "bindingMismatch") {
    return "端点变更，需重新输入 Key";
  }
  return "Key 未配置";
}

export const SettingsPage = forwardRef<SettingsPageHandle, SettingsPageProps>(
  function SettingsPage(
    {
      config,
      onClose,
      onConfigChange,
      onSaved,
      onThemePreview,
      onTypographyPreview,
    },
    ref,
  ) {
    const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
    const [themePreviewAnimationKey, setThemePreviewAnimationKey] = useState(0);
    const [animatedThemeId, setAnimatedThemeId] = useState<ThemeId | null>(
      null,
    );
    const [form, setForm] = useState<SaveAppConfigInput>({
      theme: config.theme,
      typography: {
        font: config.typography.font,
        fontSize: config.typography.fontSize,
      },
      deepseek: {
        apiKey: "",
        enabled: config.deepseek.enabled,
        baseUrl: config.deepseek.baseUrl,
        model: config.deepseek.model,
        allowInsecureLocalhost: config.deepseek.allowInsecureLocalhost,
      },
      zhipu: {
        apiKey: "",
        enabled: config.zhipu.enabled,
        baseUrl: config.zhipu.baseUrl,
        model: config.zhipu.model,
        dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
        similarityThreshold: config.zhipu.similarityThreshold,
        allowInsecureLocalhost: config.zhipu.allowInsecureLocalhost,
      },
      azure: {
        key: "",
        enabled: config.azure.enabled,
        region: config.azure.region,
        language: config.azure.language,
      },
    });
    const [saving, setSaving] = useState(false);
    const [testingDeepSeekConnection, setTestingDeepSeekConnection] =
      useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<AppError | null>(null);
    const [disclosureAcknowledged, setDisclosureAcknowledged] = useState(false);

    const referenceTheme = useMemo(
      () => getReferenceTheme(form.theme),
      [form.theme],
    );

    useEffect(() => {
      setForm({
        theme: config.theme,
        typography: {
          font: config.typography.font,
          fontSize: config.typography.fontSize,
        },
        deepseek: {
          apiKey: "",
          enabled: config.deepseek.enabled,
          baseUrl: config.deepseek.baseUrl,
          model: config.deepseek.model,
          allowInsecureLocalhost: config.deepseek.allowInsecureLocalhost,
        },
        zhipu: {
          apiKey: "",
          enabled: config.zhipu.enabled,
          baseUrl: config.zhipu.baseUrl,
          model: config.zhipu.model,
          dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
          similarityThreshold: config.zhipu.similarityThreshold,
          allowInsecureLocalhost: config.zhipu.allowInsecureLocalhost,
        },
        azure: {
          key: "",
          enabled: config.azure.enabled,
          region: config.azure.region,
          language: config.azure.language,
        },
      });
      setDisclosureAcknowledged(false);
    }, [config]);

    const submitSettings = useCallback(async () => {
      if (saving) {
        return;
      }

      setSaving(true);
      setMessage(null);
      setError(null);

      try {
        const cloudServiceWillBeEnabled =
          form.deepseek.enabled || form.zhipu.enabled || form.azure.enabled;
        if (
          cloudServiceWillBeEnabled &&
          config.disclosure.acceptedVersion !== config.disclosure.latestVersion
        ) {
          if (!disclosureAcknowledged) {
            setError({
              code: "CLOUD_DISCLOSURE_REQUIRED",
              message: "启用云服务前，请确认已阅读并接受数据流说明。",
            });
            setSaving(false);
            return;
          }
          await acceptCloudDisclosure(config.disclosure.latestVersion);
        }

        const nextConfig = await saveAppConfig({
          ...form,
          deepseek: {
            ...form.deepseek,
            apiKey: form.deepseek.apiKey?.trim() || undefined,
          },
          zhipu: {
            ...form.zhipu,
            apiKey: form.zhipu.apiKey?.trim() || undefined,
            baseUrl: form.zhipu.baseUrl.trim(),
            model: form.zhipu.model.trim(),
            dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
            similarityThreshold: Number(form.zhipu.similarityThreshold),
          },
          azure: {
            ...form.azure,
            key: form.azure.key?.trim() || undefined,
          },
        });
        onConfigChange(nextConfig);
        setSaving(false);
        onSaved();
      } catch (caught) {
        setError(caught as AppError);
        setSaving(false);
      }
    }, [
      config.disclosure,
      disclosureAcknowledged,
      form,
      onConfigChange,
      onSaved,
      saving,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        submit: () => {
          void submitSettings();
        },
      }),
      [submitSettings],
    );

    function onSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      void submitSettings();
    }

    function handleThemeChange(nextTheme: ThemeId) {
      setMessage(null);
      setError(null);
      setAnimatedThemeId(nextTheme);
      setThemePreviewAnimationKey((current) => current + 1);
      setForm((current) => ({
        ...current,
        theme: nextTheme,
      }));
      onThemePreview(nextTheme);
    }

    function handleFontPreferenceChange(nextFontPreference: FontPreference) {
      setMessage(null);
      setError(null);
      setForm((current) => ({
        ...current,
        typography: {
          ...current.typography,
          font: nextFontPreference,
        },
      }));
      onTypographyPreview({
        ...form.typography,
        font: nextFontPreference,
      });
    }

    function handleFontSizePreferenceChange(
      nextFontSizePreference: FontSizePreference,
    ) {
      setMessage(null);
      setError(null);
      setForm((current) => ({
        ...current,
        typography: {
          ...current.typography,
          fontSize: nextFontSizePreference,
        },
      }));
      onTypographyPreview({
        ...form.typography,
        fontSize: nextFontSizePreference,
      });
    }

    async function clearKey(kind: "deepseek" | "zhipu" | "azure") {
      if (saving) {
        return;
      }

      setMessage(null);
      setError(null);
      try {
        const nextConfig =
          kind === "deepseek"
            ? await clearDeepSeekKey()
            : kind === "zhipu"
              ? await clearZhipuKey()
              : await clearAzureKey();
        onConfigChange(nextConfig);
        setMessage(
          kind === "deepseek"
            ? "DeepSeek Key 已清除。"
            : kind === "zhipu"
              ? "智谱 Key 已清除。"
              : "Azure Key 已清除。",
        );
      } catch (caught) {
        setError(caught as AppError);
      }
    }

    async function testDeepSeekConnection() {
      if (saving || testingDeepSeekConnection) {
        return;
      }

      setMessage(null);
      setError(null);
      setTestingDeepSeekConnection(true);
      try {
        const result = await validateDeepSeekConfig();
        const availableModels = result.availableModels.length
          ? ` 可用模型：${result.availableModels.join(", ")}。`
          : "";
        if (result.ok) {
          setMessage(`${result.message}${availableModels}`);
        } else {
          setError({
            code: "DEEPSEEK_CONNECTIVITY_UNAVAILABLE",
            message: `${result.message}${availableModels}`,
          });
        }
      } catch (caught) {
        setError(caught as AppError);
      } finally {
        setTestingDeepSeekConnection(false);
      }
    }

    async function acknowledgeMigrationNotice() {
      if (saving) {
        return;
      }

      setMessage(null);
      setError(null);
      try {
        const nextConfig = await acceptCloudDisclosure(
          config.disclosure.latestVersion,
        );
        onConfigChange(nextConfig);
        setMessage("数据流迁移提示已确认。");
      } catch (caught) {
        setError(caught as AppError);
      }
    }

    const inputClassName = `settings-modal-input settings-modal-input-${referenceTheme}`;
    const selectClassName = `settings-modal-select settings-modal-select-${referenceTheme}`;
    const labelClassName = "block text-xs font-semibold opacity-80";

    return (
      <form
        id={SETTINGS_FORM_ID}
        onSubmit={onSubmit}
        aria-busy={saving}
        className={`settings-modal-window settings-modal-window-${referenceTheme} settings-theme-preview-motion`}
        data-preview-animation-key={themePreviewAnimationKey}
      >
        <div className="settings-modal-window-control">
          <button
            type="button"
            onClick={onClose}
            className="flex size-4 items-center justify-center rounded-full bg-red-400 text-[10px] font-bold text-red-900 opacity-85 transition hover:opacity-100"
            aria-label="关闭设置"
            title="关闭"
          >
            ×
          </button>
        </div>

        <aside
          className={`settings-modal-sidebar settings-modal-sidebar-${referenceTheme}`}
        >
          <div className="space-y-4">
            {tabOptions.map((tabOption) => {
              const TabIcon = tabOption.icon;
              const isActive = activeTab === tabOption.id;

              return (
                <button
                  key={tabOption.id}
                  type="button"
                  onClick={() => setActiveTab(tabOption.id)}
                  className={`settings-modal-tab settings-modal-tab-${referenceTheme} ${
                    isActive
                      ? `settings-modal-tab-active-${referenceTheme}`
                      : ""
                  }`}
                >
                  <TabIcon size={22} strokeWidth={2.2} />
                  <span>{tabOption.label}</span>
                </button>
              );
            })}
          </div>

          <div className="settings-modal-version">v0.1.0-rc.1</div>
        </aside>

        <section className="settings-modal-content">
          <div
            key={themePreviewAnimationKey}
            className="settings-modal-body min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <div className="settings-modal-header">
              <h2 className="text-sm font-bold tracking-tight">
                {getTabTitle(activeTab)}
              </h2>
            </div>

            {activeTab === "appearance" ? (
              <div className="settings-modal-panel">
                <div>
                  <label className={`${labelClassName} mb-4`}>界面主题</label>
                  <div className="grid gap-6 lg:grid-cols-3">
                    {themeOptions.map((themeOption) => {
                      const isSelected = form.theme === themeOption.id;

                      return (
                        <button
                          key={themeOption.id}
                          type="button"
                          disabled={saving}
                          onClick={() => handleThemeChange(themeOption.id)}
                          className={`settings-theme-card settings-theme-card-${referenceTheme} ${
                            isSelected
                              ? `settings-theme-card-active-${referenceTheme}`
                              : ""
                          } ${animatedThemeId === themeOption.id ? "settings-theme-card-pulse" : ""} ${
                            animatedThemeId === themeOption.id && isSelected
                              ? `settings-theme-card-pulse-${referenceTheme}`
                              : ""
                          }`}
                        >
                          <span className="block text-xs font-bold">
                            {themeOption.name}
                          </span>
                          <span className="block text-[10px] leading-5 opacity-60">
                            {themeOption.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="settings-modal-alert">
                  <AlertCircle size={28} className="mt-1 shrink-0 opacity-80" />
                  <p>
                    主题会在切换后全局即时更新。外观样式经由 macOS
                    界面风格拟合，对文字排版和控件大小进行了针对性调优。
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === "typography" ? (
              <div className="settings-modal-panel max-w-[760px]">
                <div>
                  <label className={`${labelClassName} mb-3`}>正文字体</label>
                  <select
                    value={form.typography.font}
                    disabled={saving}
                    onChange={(event) =>
                      handleFontPreferenceChange(
                        event.target.value as FontPreference,
                      )
                    }
                    className={selectClassName}
                  >
                    <option value="system">
                      Inter / PingFang SC - 现代高清晰无衬线体
                    </option>
                    <option value="serif">
                      Georgia / Songti SC - 优雅人文比例宋体
                    </option>
                    <option value="space">
                      Space Grotesk / Heiti SC - 技术感无衬线体
                    </option>
                    <option value="mono">
                      JetBrains Mono / Kaiti SC - 极简科技感等宽体
                    </option>
                  </select>
                </div>

                <div>
                  <label className={`${labelClassName} mb-4`}>
                    全局字号缩放
                  </label>
                  <div className="flex flex-wrap gap-5">
                    {(["small", "medium", "large"] as FontSizePreference[]).map(
                      (fontSizeOption) => (
                        <button
                          key={fontSizeOption}
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            handleFontSizePreferenceChange(fontSizeOption)
                          }
                          className={`settings-size-option ${
                            form.typography.fontSize === fontSizeOption
                              ? "settings-size-option-active"
                              : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name="fontSize"
                            value={fontSizeOption}
                            disabled={saving}
                            checked={
                              form.typography.fontSize === fontSizeOption
                            }
                            onChange={() => undefined}
                            className="settings-modal-radio"
                            tabIndex={-1}
                          />
                          <span>
                            {fontSizeOption === "small"
                              ? "小字号 (Compact)"
                              : null}
                            {fontSizeOption === "medium"
                              ? "标准 (Default)"
                              : null}
                            {fontSizeOption === "large"
                              ? "大字号 (Relaxed)"
                              : null}
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div className="settings-preview-box">
                  <span className="settings-preview-caption mb-3 block text-[11px] uppercase tracking-wider opacity-40">
                    字体及字号排版预览
                  </span>
                  <p
                    className={`settings-preview-text settings-preview-text-${form.typography.font} leading-relaxed opacity-80 ${
                      form.typography.fontSize === "small"
                        ? "text-xs"
                        : form.typography.fontSize === "large"
                          ? "text-base"
                          : "text-sm"
                    }`}
                  >
                    She spoke with deep fluency and demonstrated a solid grasp
                    of complex lexical structures. However, slight subject-verb
                    discord was noticed near the beginning at 00:15.
                  </p>
                </div>
              </div>
            ) : null}

            {activeTab === "ai" ? (
              <div className="settings-modal-panel max-w-[780px]">
                {config.disclosure.noticeRequired ? (
                  <div className="settings-modal-alert settings-modal-alert-warning">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div className="grid gap-3 text-xs leading-5">
                      <p>
                        DeepSeek 会接收题目、Part、回答或 Transcript
                        及命中的教师案例；智谱会接收教师案例，或由题目和回答/Transcript
                        组成的检索文本；Azure 会接收 WAV 音频与可选 reference
                        text。 数据由对应服务商处理。
                      </p>
                      <p>
                        历史、生成媒体、教师案例和向量保留在本机，Key 仅保存在
                        macOS
                        钥匙串。停用服务只会阻止新的网络请求，不会删除本地数据或
                        Key；清除 Key 和删除数据需要分别操作。
                      </p>
                      {config.disclosure.acceptedVersion !==
                      config.disclosure.latestVersion ? (
                        <label className="flex items-start gap-2 font-semibold">
                          <input
                            type="checkbox"
                            checked={disclosureAcknowledged}
                            disabled={saving}
                            onChange={(event) =>
                              setDisclosureAcknowledged(event.target.checked)
                            }
                            className="mt-1"
                          />
                          <span>
                            我已阅读并接受版本 {config.disclosure.latestVersion}{" "}
                            的云服务数据流说明
                          </span>
                        </label>
                      ) : (
                        <button
                          type="button"
                          className="settings-clear-button w-fit"
                          disabled={saving}
                          onClick={() => void acknowledgeMigrationNotice()}
                        >
                          确认已知悉
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="settings-engine-section">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <label className={labelClassName}>AI 口语批改模型</label>
                      <h3 className="mt-1 text-sm font-bold">
                        DeepSeek Evaluator
                      </h3>
                    </div>
                    <span
                      className={`settings-key-status ${config.deepseek.apiKeyConfigured ? "is-ready" : "is-missing"}`}
                    >
                      <CheckCircle2 size={14} />
                      {getCredentialStatusLabel(
                        config.deepseek.credentialStatus,
                      )}
                    </span>
                  </div>

                  <label className="mb-4 flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.deepseek.enabled}
                      disabled={saving}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          deepseek: {
                            ...current.deepseek,
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>启用 DeepSeek 云端批改</span>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 md:col-span-2">
                      <span className={labelClassName}>API Key</span>
                      <input
                        type="password"
                        value={form.deepseek.apiKey}
                        disabled={saving}
                        placeholder={
                          config.deepseek.apiKeyConfigured
                            ? "保持为空则继续使用已保存 Key"
                            : "sk-..."
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deepseek: {
                              ...current.deepseek,
                              apiKey: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>Base URL</span>
                      <input
                        value={form.deepseek.baseUrl}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deepseek: {
                              ...current.deepseek,
                              baseUrl: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="flex items-center gap-2 text-xs md:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.deepseek.allowInsecureLocalhost}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deepseek: {
                              ...current.deepseek,
                              allowInsecureLocalhost: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>允许显式使用本机 HTTP 调试端点</span>
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>模型</span>
                      <select
                        value={form.deepseek.model}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            deepseek: {
                              ...current.deepseek,
                              model: event.target
                                .value as SaveAppConfigInput["deepseek"]["model"],
                            },
                          }))
                        }
                        className={selectClassName}
                      >
                        {preferredDeepSeekModelOptions.map((modelOption) => (
                          <option
                            key={modelOption.value}
                            value={modelOption.value}
                          >
                            {modelOption.label}
                          </option>
                        ))}
                        {!preferredDeepSeekModelOptions.some(
                          (modelOption) =>
                            modelOption.value === form.deepseek.model,
                        ) ? (
                          <option value={form.deepseek.model}>
                            {form.deepseek.model}（旧配置兼容）
                          </option>
                        ) : null}
                      </select>
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void testDeepSeekConnection()}
                      disabled={saving || testingDeepSeekConnection}
                      className="settings-clear-button"
                    >
                      <ServerCog size={16} />
                      {testingDeepSeekConnection
                        ? "测试中"
                        : "测试 DeepSeek 连接"}
                    </button>
                    <p className="self-center text-xs leading-5 opacity-60">
                      测试使用已保存的 DeepSeek Key、Base URL 和模型。
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void clearKey("deepseek")}
                    disabled={saving}
                    className="settings-clear-button"
                  >
                    <KeyRound size={16} />
                    清除 DeepSeek Key
                  </button>
                </div>

                <div className="settings-engine-section">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <label className={labelClassName}>
                        教师案例 Embedding 模型
                      </label>
                      <h3 className="mt-1 text-sm font-bold">
                        智谱 embedding-3
                      </h3>
                    </div>
                    <span
                      className={`settings-key-status ${config.zhipu.apiKeyConfigured ? "is-ready" : "is-missing"}`}
                    >
                      <CheckCircle2 size={14} />
                      {getCredentialStatusLabel(config.zhipu.credentialStatus)}
                    </span>
                  </div>

                  <label className="mb-4 flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.zhipu.enabled}
                      disabled={saving}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          zhipu: {
                            ...current.zhipu,
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>启用智谱云端 Embedding</span>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 md:col-span-2">
                      <span className={labelClassName}>智谱 API Key</span>
                      <input
                        type="password"
                        value={form.zhipu.apiKey}
                        disabled={saving}
                        placeholder={
                          config.zhipu.apiKeyConfigured
                            ? "保持为空则继续使用已保存 Key"
                            : "Zhipu API Key"
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              apiKey: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>Base URL</span>
                      <input
                        value={form.zhipu.baseUrl}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              baseUrl: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="flex items-center gap-2 text-xs md:col-span-2">
                      <input
                        type="checkbox"
                        checked={form.zhipu.allowInsecureLocalhost}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              allowInsecureLocalhost: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>允许显式使用本机 HTTP 调试端点</span>
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>模型</span>
                      <input
                        value={form.zhipu.model}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              model: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>向量维度</span>
                      <select
                        value={form.zhipu.dimensions}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              dimensions: Number(
                                event.target.value,
                              ) as SaveAppConfigInput["zhipu"]["dimensions"],
                            },
                          }))
                        }
                        className={selectClassName}
                      >
                        <option value={ZHIPU_EMBEDDING_DIMENSIONS}>
                          {ZHIPU_EMBEDDING_DIMENSIONS}
                        </option>
                      </select>
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>RAG 相似度阈值</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={form.zhipu.similarityThreshold}
                        disabled={saving}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            zhipu: {
                              ...current.zhipu,
                              similarityThreshold: Number(event.target.value),
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void clearKey("zhipu")}
                      disabled={saving}
                      className="settings-clear-button"
                    >
                      <KeyRound size={16} />
                      清除智谱 Key
                    </button>
                    <p className="self-center text-xs leading-5 opacity-60">
                      教师案例重建 Embedding 和 Top-K 检索使用智谱接口；Key
                      仅保存在 macOS 钥匙串。
                    </p>
                  </div>
                </div>

                <div className="settings-engine-section">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <label className={labelClassName}>
                        文件语音转文字模型
                      </label>
                      <h3 className="mt-1 text-sm font-bold">
                        Azure Pronunciation Assessment
                      </h3>
                    </div>
                    <span
                      className={`settings-key-status ${config.azure.keyConfigured ? "is-ready" : "is-missing"}`}
                    >
                      <CheckCircle2 size={14} />
                      {getCredentialStatusLabel(config.azure.credentialStatus)}
                    </span>
                  </div>

                  <label className="mb-4 flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={form.azure.enabled}
                      disabled={saving}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          azure: {
                            ...current.azure,
                            enabled: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>启用 Azure 云端语音评估</span>
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 md:col-span-2">
                      <span className={labelClassName}>Azure Key</span>
                      <input
                        type="password"
                        value={form.azure.key}
                        disabled={saving}
                        placeholder={
                          config.azure.keyConfigured
                            ? "保持为空则继续使用已保存 Key"
                            : "Azure speech key"
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            azure: {
                              ...current.azure,
                              key: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>Region</span>
                      <input
                        value={form.azure.region}
                        disabled={saving}
                        placeholder="eastasia"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            azure: {
                              ...current.azure,
                              region: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>

                    <label className="grid gap-2">
                      <span className={labelClassName}>Language</span>
                      <input
                        value={form.azure.language}
                        disabled={saving}
                        placeholder="en-US"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            azure: {
                              ...current.azure,
                              language: event.target.value,
                            },
                          }))
                        }
                        className={inputClassName}
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => void clearKey("azure")}
                    disabled={saving}
                    className="settings-clear-button"
                  >
                    <ServerCog size={16} />
                    清除 Azure Key
                  </button>
                </div>

                <div className="settings-modal-alert settings-modal-alert-warning">
                  <AlertCircle size={20} className="mt-0.5 shrink-0" />
                  <p>
                    <b>密钥安全提示</b>：API Key 只写入 macOS
                    钥匙串；配置文件中的兼容字段始终为
                    null，保存后不会在前端回显完整密钥。
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="settings-modal-footer">
            <div className="min-h-6 flex-1">
              {message ? (
                <p className="settings-save-message">{message}</p>
              ) : null}
              {error ? (
                <p className="settings-save-error">{error.message}</p>
              ) : null}
            </div>
            <button
              type="submit"
              disabled={saving}
              className={`settings-apply-button settings-apply-button-${referenceTheme}`}
            >
              {saving ? "保存中" : "完成并应用"}
            </button>
          </div>
        </section>
      </form>
    );
  },
);
