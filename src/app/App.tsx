import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { CorpusPage } from "../features/corpus/CorpusPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useAppConfig } from "../hooks/useAppConfig";
import { useGradingWorkflow } from "../hooks/useGradingWorkflow";
import { useSessionHistory } from "../hooks/useSessionHistory";
import { selectMediaFile } from "../lib/media";
import type { AppError } from "../types/errors";
import type { MenuId } from "./workspaceTypes";
import { FinderSidebar } from "../components/workspace/FinderSidebar";
import { HelpModal } from "../components/workspace/HelpModal";
import { MacMenuBar } from "../components/workspace/MacMenuBar";
import { WindowStatusBar } from "../components/workspace/WindowStatusBar";
import { Workspace } from "../components/workspace/Workspace";

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const [corpusOpen, setCorpusOpen] = useState(false);
  const [pendingMediaPath, setPendingMediaPath] = useState("");
  const appConfig = useAppConfig({ onThemeMenuSelection: () => setActiveMenu(null) });
  const sessionHistory = useSessionHistory();

  const gradingWorkflow = useGradingWorkflow({
    config: appConfig.previewConfig,
    serviceReady: Boolean(appConfig.health),
    onAddRecord: sessionHistory.addRecord,
    onAfterTextRecordAdded: () => setPendingMediaPath(""),
  });

  function openMenu(menuId: MenuId, event: React.MouseEvent) {
    event.stopPropagation();
    setActiveMenu(menuId);
  }

  function switchTheme(theme: Parameters<typeof appConfig.switchTheme>[0]) {
    appConfig.switchTheme(theme);
    setActiveMenu(null);
  }

  function closeSettings() {
    appConfig.resetPreviewToSavedConfig();
    setSettingsOpen(false);
  }

  function closeSettingsAfterSave() {
    setSettingsOpen(false);
  }

  function resetWorkspace() {
    sessionHistory.setActiveRecordId(null);
    setPendingMediaPath("");
    gradingWorkflow.setWorkspaceError(null);
    setActiveMenu(null);
    setCorpusOpen(false);
  }

  async function importMediaFromMenu() {
    setActiveMenu(null);
    sessionHistory.setActiveRecordId(null);
    setCorpusOpen(false);
    gradingWorkflow.setWorkspaceError(null);

    try {
      const selectedPath = await selectMediaFile();
      if (selectedPath) {
        setPendingMediaPath(selectedPath);
      }
    } catch (error) {
      gradingWorkflow.setWorkspaceError(error as AppError);
    }
  }

  const visibleError = gradingWorkflow.workspaceError ?? appConfig.startupError;

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden text-text ${appConfig.themeClass} ${appConfig.typographyClass}`}>
      <MacMenuBar
        activeMenu={activeMenu}
        menuClock={appConfig.menuClock}
        previewTheme={appConfig.previewTheme}
        onOpenMenu={openMenu}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        onReset={resetWorkspace}
        onImportMedia={() => void importMediaFromMenu()}
        onSwitchTheme={switchTheme}
      />

      <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
        <div className="app-window flex h-full max-h-[820px] w-full max-w-6xl flex-col overflow-hidden">
          <div className="window-titlebar">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={resetWorkspace}
                className="window-dot bg-[#ff5f57] text-[8px] font-bold text-red-950"
                aria-label="清空会话"
              >
                x
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="window-dot bg-[#febc2e]"
                aria-label="打开设置"
              />
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="window-dot bg-[#28c840]"
                aria-label="打开帮助"
              />
            </div>
            <h1 className="flex min-w-0 items-center gap-1.5 text-xs font-bold tracking-tight opacity-75">
              <GraduationCap size={14} />
              <span className="truncate">IELTS Speaking Examiner - 雅思口语提分大师</span>
            </h1>
            <div className="w-14" />
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="finder-sidebar hidden h-full w-64 shrink-0 flex-col border-r border-border lg:flex">
              <FinderSidebar
                records={sessionHistory.records}
                activeRecordId={sessionHistory.activeRecordId}
                currentTheme={appConfig.referenceTheme}
                corpusOpen={corpusOpen}
                onSelectRecord={(recordId) => {
                  setCorpusOpen(false);
                  sessionHistory.setActiveRecordId(recordId);
                }}
                onDeleteRecord={sessionHistory.deleteRecord}
                onNewSession={resetWorkspace}
                onOpenCorpus={() => {
                  setCorpusOpen(true);
                  sessionHistory.setActiveRecordId(null);
                }}
              />
            </aside>

            <main className="relative flex min-w-0 flex-1 flex-col justify-between overflow-y-auto bg-transparent p-3 sm:p-5">
              {visibleError ? (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
                  {visibleError.message}
                </div>
              ) : null}

              {corpusOpen ? (
                <CorpusPage />
              ) : (
                <Workspace
                  activeRecord={sessionHistory.activeRecord}
                  config={appConfig.previewConfig}
                  currentTheme={appConfig.referenceTheme}
                  isLoading={gradingWorkflow.loading}
                  pendingMediaPath={pendingMediaPath}
                  serviceReady={Boolean(appConfig.health)}
                  onClearPendingMedia={() => setPendingMediaPath("")}
                  onAddRecord={sessionHistory.addRecord}
                  onSubmitText={gradingWorkflow.submitTextForGrading}
                />
              )}
            </main>
          </div>

          <WindowStatusBar
            serviceReady={Boolean(appConfig.health)}
            serviceLabel={appConfig.serviceLabel}
            themeLabel={appConfig.themeLabel}
            recordCount={sessionHistory.records.length}
          />
        </div>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-[2147483002] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <SettingsPage
            config={appConfig.config}
            onClose={closeSettings}
            onConfigChange={appConfig.applyConfig}
            onSaved={closeSettingsAfterSave}
            onTypographyPreview={appConfig.setPreviewTypography}
            onThemePreview={appConfig.setPreviewTheme}
          />
        </div>
      ) : null}

      {helpOpen ? (
        <HelpModal currentTheme={appConfig.referenceTheme} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}
