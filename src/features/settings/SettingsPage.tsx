import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Field, SelectInput, TextInput } from "../../components/Field";
import { StatusPill } from "../../components/StatusPill";
import {
  clearAzureKey,
  clearDeepSeekKey,
  saveAppConfig,
} from "../../lib/config";
import type { PublicAppConfig, SaveAppConfigInput, ThemeId } from "../../types/config";
import type { AppError } from "../../types/errors";

type SettingsPageProps = {
  config: PublicAppConfig;
  onConfigChange: (config: PublicAppConfig) => void;
  onThemePreview: (theme: ThemeId) => void;
};

export type SettingsPageHandle = {
  submit: () => void;
};

export const SETTINGS_FORM_ID = "app-settings-form";

export const SettingsPage = forwardRef<SettingsPageHandle, SettingsPageProps>(function SettingsPage(
  { config, onConfigChange, onThemePreview },
  ref,
) {
  const [form, setForm] = useState<SaveAppConfigInput>({
    theme: config.theme,
    deepseek: {
      apiKey: "",
      baseUrl: config.deepseek.baseUrl,
      model: config.deepseek.model,
    },
    azure: {
      key: "",
      region: config.azure.region,
      language: config.azure.language,
    },
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    setForm({
      theme: config.theme,
      deepseek: {
        apiKey: "",
        baseUrl: config.deepseek.baseUrl,
        model: config.deepseek.model,
      },
      azure: {
        key: "",
        region: config.azure.region,
        language: config.azure.language,
      },
    });
  }, [config]);

  const submitSettings = useCallback(async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const nextConfig = await saveAppConfig({
        ...form,
        deepseek: {
          ...form.deepseek,
          apiKey: form.deepseek.apiKey?.trim() || undefined,
        },
        azure: {
          ...form.azure,
          key: form.azure.key?.trim() || undefined,
        },
      });
      onConfigChange(nextConfig);
      setMessage("设置已保存。");
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setSaving(false);
    }
  }, [form, onConfigChange, saving]);

  useImperativeHandle(ref, () => ({
    submit: () => {
      void submitSettings();
    },
  }), [submitSettings]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitSettings();
  }

  async function clearKey(kind: "deepseek" | "azure") {
    setMessage(null);
    setError(null);
    try {
      const nextConfig = kind === "deepseek" ? await clearDeepSeekKey() : await clearAzureKey();
      onConfigChange(nextConfig);
      setMessage(kind === "deepseek" ? "DeepSeek Key 已清除。" : "Azure Key 已清除。");
    } catch (caught) {
      setError(caught as AppError);
    }
  }

  return (
    <form id={SETTINGS_FORM_ID} onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-6">
        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">外观</h3>
            <StatusPill tone="muted">{form.theme}</StatusPill>
          </div>
          <Field label="主题">
            <SelectInput
              value={form.theme}
              onChange={(event) => {
                const nextTheme = event.target.value as SaveAppConfigInput["theme"];
                setForm((current) => ({
                  ...current,
                  theme: nextTheme,
                }));
                onThemePreview(nextTheme);
              }}
            >
              <option value="theme-claude">Claude</option>
              <option value="theme-animal">Animal</option>
              <option value="theme-glass">Glass</option>
            </SelectInput>
          </Field>
        </Card>

        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">DeepSeek</h3>
            <StatusPill tone={config.deepseek.apiKeyConfigured ? "ok" : "warn"}>
              {config.deepseek.apiKeyConfigured ? "Key 已配置" : "Key 未配置"}
            </StatusPill>
          </div>
          <div className="grid gap-4">
            <Field label="API Key" hint="保存后不会在前端回显完整密钥。">
              <TextInput
                type="password"
                value={form.deepseek.apiKey}
                placeholder={config.deepseek.apiKeyConfigured ? "保持为空则继续使用已保存 Key" : "sk-..."}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    deepseek: { ...current.deepseek, apiKey: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Base URL">
              <TextInput
                value={form.deepseek.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    deepseek: { ...current.deepseek, baseUrl: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="模型">
              <SelectInput
                value={form.deepseek.model}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    deepseek: {
                      ...current.deepseek,
                      model: event.target.value as SaveAppConfigInput["deepseek"]["model"],
                    },
                  }))
                }
              >
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="deepseek-reasoner">deepseek-reasoner</option>
              </SelectInput>
            </Field>
            <Button type="button" variant="danger" onClick={() => clearKey("deepseek")}>
              清除 DeepSeek Key
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Azure Pronunciation Assessment</h3>
            <StatusPill tone={config.azure.keyConfigured ? "ok" : "warn"}>
              {config.azure.keyConfigured ? "Key 已配置" : "Key 未配置"}
            </StatusPill>
          </div>
          <div className="grid gap-4">
            <Field label="Azure Key" hint="保存后不会在前端回显完整密钥。">
              <TextInput
                type="password"
                value={form.azure.key}
                placeholder={config.azure.keyConfigured ? "保持为空则继续使用已保存 Key" : "Azure speech key"}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    azure: { ...current.azure, key: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Region">
              <TextInput
                value={form.azure.region}
                placeholder="eastasia"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    azure: { ...current.azure, region: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Language">
              <TextInput
                value={form.azure.language}
                placeholder="en-US"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    azure: { ...current.azure, language: event.target.value },
                  }))
                }
              />
            </Field>
            <Button type="button" variant="danger" onClick={() => clearKey("azure")}>
              清除 Azure Key
            </Button>
          </div>
        </Card>
      </div>

      <aside className="h-fit rounded-app border border-border bg-surface p-5 shadow-app">
        <h3 className="text-lg font-semibold">保存</h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          配置由 Rust command 读写。API Key 只显示是否已配置，不在页面回显。
        </p>
        {message ? <div className="mt-4 rounded-app bg-primary/10 p-3 text-sm text-primary-strong">{message}</div> : null}
        {error ? <div className="mt-4 rounded-app bg-danger/10 p-3 text-sm text-danger">{error.message}</div> : null}
        <Button type="submit" variant="primary" disabled={saving} className="mt-5 w-full">
          {saving ? "保存中" : "保存设置"}
        </Button>
      </aside>
    </form>
  );
});
