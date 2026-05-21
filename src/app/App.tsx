import { useEffect, useRef, useState } from "react";
import { GraduationCap, Save, Settings, X } from "lucide-react";
import { GradingPage } from "../features/grading/GradingPage";
import { SettingsPage, type SettingsPageHandle } from "../features/settings/SettingsPage";
import { defaultPublicConfig, type PublicAppConfig, type ThemeId } from "../types/config";
import { getAppConfig } from "../lib/config";
import { invokeCommand, type HealthCheckResult } from "../lib/tauri";
import type { AppError } from "../types/errors";

export function App() {
  const [config, setConfig] = useState<PublicAppConfig>(defaultPublicConfig);
  const [previewTheme, setPreviewTheme] = useState<ThemeId>(defaultPublicConfig.theme);
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [startupError, setStartupError] = useState<AppError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPageRef = useRef<SettingsPageHandle>(null);
  const isGlassTheme = previewTheme === "theme-glass";
  const previewConfig: PublicAppConfig = { ...config, theme: previewTheme };

  useEffect(() => {
    document.documentElement.classList.remove("theme-claude", "theme-animal", "theme-glass");
    document.documentElement.classList.add(previewTheme);
  }, [previewTheme]);

  useEffect(() => {
    Promise.all([getAppConfig(), invokeCommand<HealthCheckResult>("health_check")])
      .then(([appConfig, healthCheck]) => {
        setConfig(appConfig);
        setPreviewTheme(appConfig.theme);
        setHealth(healthCheck);
        setStartupError(null);
      })
      .catch((error: AppError) => {
        setStartupError(error);
      });
  }, []);

  const serviceLabel = health ? "本地服务端就绪" : startupError ? "本地服务未连接" : "检查本地服务";
  const appTitle = isGlassTheme ? "Mac 极净玻璃雅思口语评测舱" : "雅思口语评测评课系统";
  const appSubtitle = isGlassTheme
    ? "搭载 Apple Liquid Glass 原生质感，深邃全透明视觉，适配高强度诊断作业"
    : "为优秀教师定制的智能口语作业收交、高精度自动转写与学术提星评估方案";

  function applyConfig(nextConfig: PublicAppConfig) {
    setConfig(nextConfig);
    setPreviewTheme(nextConfig.theme);
  }

  function closeSettings() {
    setPreviewTheme(config.theme);
    setSettingsOpen(false);
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-[74px] max-w-[1340px] items-center justify-between gap-4 px-6 max-md:h-auto max-md:flex-col max-md:items-start max-md:py-4">
          <div className="flex min-w-0 items-center gap-3 max-md:w-full">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-app bg-primary text-white shadow-sm">
              <GraduationCap size={22} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-[22px] font-semibold leading-tight tracking-[-0.01em] max-md:text-[18px]">
                  {appTitle}
                </h1>
                <span className="island-badge rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-[12px] font-semibold text-accent">
                  PRO
                </span>
              </div>
              <p className="mt-1 truncate text-[13px] text-muted">
                {appSubtitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
            <span className="font-mono tracking-[0.08em]">系统沙盒状态：CLAUDE MINI-DESIGN</span>
            <span
              className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold ${
                health
                  ? "border-primary/30 bg-primary/10 text-primary-strong"
                  : "border-accent/30 bg-accent/10 text-accent"
              }`}
            >
              ● {serviceLabel}
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[12px] font-semibold text-muted shadow-sm"
            >
              <Settings size={14} />
              设置
            </button>
          </div>
        </div>
      </header>

      <GradingPage config={previewConfig} serviceReady={Boolean(health)} />

      {settingsOpen ? (
        <div className="fixed inset-0 z-[2147483002] overflow-y-auto bg-text/35 px-6 py-8 backdrop-blur-sm">
          <div className="mx-auto max-w-[1180px] rounded-xl border border-border bg-surface shadow-[0_24px_80px_rgb(var(--color-text)/0.22)]">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-lg font-bold">应用设置</h2>
                <p className="mt-1 text-[13px] text-muted">配置 DeepSeek、Azure 和主题。</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => settingsPageRef.current?.submit()}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-strong"
                >
                  <Save size={16} />
                  保存设置
                </button>
                <button
                  type="button"
                  onClick={closeSettings}
                  className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-muted"
                  aria-label="关闭设置"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="p-6">
              <SettingsPage
                ref={settingsPageRef}
                config={config}
                onConfigChange={applyConfig}
                onThemePreview={setPreviewTheme}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
