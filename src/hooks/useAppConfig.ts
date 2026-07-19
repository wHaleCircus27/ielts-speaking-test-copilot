import { useEffect, useMemo, useRef, useState } from "react";
import { getAppConfig } from "../lib/config";
import { invokeCommand, type HealthCheckResult } from "../lib/tauri";
import {
  defaultPublicConfig,
  type PublicAppConfig,
  type ThemeId,
} from "../types/config";
import type { AppError } from "../types/errors";
import {
  getReferenceTheme,
  getReferenceThemeClass,
  getThemeLabel,
  getTypographyClass,
  isTauriRuntimeAvailable,
} from "../app/workspaceUtils";

export function useAppConfig({
  onThemeMenuSelection,
}: { onThemeMenuSelection?: () => void } = {}) {
  const [config, setConfig] = useState<PublicAppConfig>(defaultPublicConfig);
  const [previewTheme, setPreviewTheme] = useState<ThemeId>(
    defaultPublicConfig.theme,
  );
  const [previewTypography, setPreviewTypography] = useState<
    PublicAppConfig["typography"]
  >(defaultPublicConfig.typography);
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [startupError, setStartupError] = useState<AppError | null>(null);
  const [menuClock, setMenuClock] = useState("");
  const userSelectedThemeRef = useRef(false);

  const previewConfig = useMemo<PublicAppConfig>(
    () => ({ ...config, theme: previewTheme, typography: previewTypography }),
    [config, previewTheme, previewTypography],
  );
  const serviceLabel = health
    ? "大模型测评引擎已就绪"
    : startupError
      ? "本地服务未连接"
      : "检查本地服务";
  const themeLabel = getThemeLabel(previewTheme);
  const referenceTheme = getReferenceTheme(previewTheme);
  const themeClass = getReferenceThemeClass(previewTheme);
  const typographyClass = getTypographyClass(
    previewTypography.font,
    previewTypography.fontSize,
  );

  useEffect(() => {
    document.documentElement.classList.remove(
      "theme-claude",
      "theme-animal",
      "theme-glass",
    );
    document.documentElement.classList.add(previewTheme);
  }, [previewTheme]);

  useEffect(() => {
    const healthCheckPromise = isTauriRuntimeAvailable()
      ? invokeCommand<HealthCheckResult>("health_check")
      : Promise.resolve<HealthCheckResult>({
          ok: true,
          version: "browser-preview",
          platform: "browser",
        });

    Promise.all([getAppConfig(), healthCheckPromise])
      .then(([appConfig, healthCheck]) => {
        setConfig(appConfig);
        if (!userSelectedThemeRef.current) {
          setPreviewTheme(appConfig.theme);
          setPreviewTypography(appConfig.typography);
        }
        setHealth(healthCheck);
        setStartupError(null);
      })
      .catch((error: AppError) => {
        setStartupError(error);
      });
  }, []);

  useEffect(() => {
    const handleThemeMenuPointer = (event: Event) => {
      const targetElement =
        event.target instanceof Element ? event.target : null;
      const themeButton =
        targetElement?.closest<HTMLButtonElement>("[data-theme-id]");
      const themeId = themeButton?.dataset.themeId as ThemeId | undefined;
      if (!themeId) {
        return;
      }

      event.stopPropagation();
      userSelectedThemeRef.current = true;
      setPreviewTheme(themeId);
      onThemeMenuSelection?.();
    };

    document.addEventListener("pointerdown", handleThemeMenuPointer, true);
    document.addEventListener("mousedown", handleThemeMenuPointer, true);
    document.addEventListener("click", handleThemeMenuPointer, true);
    return () => {
      document.removeEventListener("pointerdown", handleThemeMenuPointer, true);
      document.removeEventListener("mousedown", handleThemeMenuPointer, true);
      document.removeEventListener("click", handleThemeMenuPointer, true);
    };
  }, [onThemeMenuSelection]);

  useEffect(() => {
    const refreshClock = () => {
      setMenuClock(
        new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
    };

    refreshClock();
    const timerId = window.setInterval(refreshClock, 15_000);
    return () => window.clearInterval(timerId);
  }, []);

  function applyConfig(nextConfig: PublicAppConfig) {
    setConfig(nextConfig);
    userSelectedThemeRef.current = false;
    setPreviewTheme(nextConfig.theme);
    setPreviewTypography(nextConfig.typography);
  }

  function switchTheme(theme: ThemeId) {
    userSelectedThemeRef.current = true;
    setPreviewTheme(theme);
  }

  function resetPreviewToSavedConfig() {
    setPreviewTheme(config.theme);
    setPreviewTypography(config.typography);
  }

  return {
    config,
    previewConfig,
    previewTheme,
    previewTypography,
    health,
    startupError,
    menuClock,
    serviceLabel,
    themeLabel,
    referenceTheme,
    themeClass,
    typographyClass,
    applyConfig,
    switchTheme,
    setPreviewTheme,
    setPreviewTypography,
    resetPreviewToSavedConfig,
  };
}
