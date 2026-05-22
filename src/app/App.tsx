import { useEffect, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Apple,
  ArrowRight,
  Battery,
  BookOpen,
  Bookmark,
  ChevronDown,
  CheckCircle2,
  Clock,
  CornerDownRight,
  Database,
  FileAudio,
  FileText,
  FileVideo,
  GraduationCap,
  HardDrive,
  HelpCircle,
  History,
  Loader2,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Wifi,
  X,
} from "lucide-react";
import { CorpusPage } from "../features/corpus/CorpusPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { getAppConfig } from "../lib/config";
import { gradeSpeaking } from "../lib/grading";
import { getMediaMetadata, selectMediaFile, transcodeMedia } from "../lib/media";
import { assessPronunciation, validateAzureConfig } from "../lib/speech";
import { invokeCommand, type HealthCheckResult } from "../lib/tauri";
import { buildTranscriptTokens, findCurrentWordToken, getTranscriptText, lowAccuracyThreshold } from "../lib/transcript";
import {
  defaultPublicConfig,
  type FontPreference,
  type FontSizePreference,
  type PublicAppConfig,
  type ThemeId,
} from "../types/config";
import type { AppError } from "../types/errors";
import type { GradeResult, SpeakingPart } from "../types/grading";
import type { MediaMetadata, MediaTranscodeResult } from "../types/media";
import type { SpeechAssessmentResult, TranscriptToken } from "../types/speech";

type MenuId = "app" | "file" | "themes";
type InputMode = "media" | "text";
type ResultTab = "overall" | "fluency" | "lexical" | "grammar" | "pronunciation" | "corrections";
type CorrectionCategory = "grammar" | "vocabulary" | "pronunciation" | "coherence";

type TranscriptChunk = {
  timestamp: string;
  text: string;
  seconds: number;
};

type ScoreCriterion = {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

type SentenceCorrection = {
  original: string;
  improved: string;
  reason: string;
  category: CorrectionCategory;
};

type WorkspaceResult = {
  overallScore: number;
  fluencyScore: ScoreCriterion;
  lexicalScore: ScoreCriterion;
  grammarScore: ScoreCriterion;
  pronunciationScore: ScoreCriterion;
  keyCorrections: SentenceCorrection[];
  generalFeedback: string;
  modelAnswer: string;
  transcript: TranscriptChunk[];
  transcriptTokens?: TranscriptToken[];
  speechAssessment?: SpeechAssessmentResult;
};

type CorrectionRecord = {
  id: string;
  title: string;
  date: string;
  fileName: string;
  duration: string;
  transcript: TranscriptChunk[];
  result: WorkspaceResult;
};

const recordsStorageKey = "ielts_copilot_correction_records";

export function App() {
  const [config, setConfig] = useState<PublicAppConfig>(defaultPublicConfig);
  const [previewTheme, setPreviewTheme] = useState<ThemeId>(defaultPublicConfig.theme);
  const [previewTypography, setPreviewTypography] = useState<PublicAppConfig["typography"]>(
    defaultPublicConfig.typography,
  );
  const [health, setHealth] = useState<HealthCheckResult | null>(null);
  const [startupError, setStartupError] = useState<AppError | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuId | null>(null);
  const [menuClock, setMenuClock] = useState("");
  const [records, setRecords] = useState<CorrectionRecord[]>([]);
  const [corpusOpen, setCorpusOpen] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<AppError | null>(null);
  const [pendingMediaPath, setPendingMediaPath] = useState("");
  const userSelectedThemeRef = useRef(false);
  const previewConfig = useMemo<PublicAppConfig>(
    () => ({ ...config, theme: previewTheme, typography: previewTypography }),
    [config, previewTheme, previewTypography],
  );
  const activeRecord = records.find((record) => record.id === activeRecordId) ?? null;
  const serviceLabel = health ? "大模型测评引擎已就绪" : startupError ? "本地服务未连接" : "检查本地服务";
  const themeLabel = getThemeLabel(previewTheme);
  const referenceTheme = getReferenceTheme(previewTheme);
  const themeClass = getReferenceThemeClass(previewTheme);
  const typographyClass = getTypographyClass(previewTypography.font, previewTypography.fontSize);

  useEffect(() => {
    document.documentElement.classList.remove("theme-claude", "theme-animal", "theme-glass");
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
    const storedRecords = window.localStorage.getItem(recordsStorageKey);
    if (storedRecords) {
      try {
        const parsedRecords = JSON.parse(storedRecords) as CorrectionRecord[];
        const realRecords = parsedRecords.filter((record) => record.id !== "demo-assignment-technology");
        setRecords(realRecords);
        setActiveRecordId(realRecords[0]?.id ?? null);
        if (realRecords.length) {
          window.localStorage.setItem(recordsStorageKey, JSON.stringify(realRecords));
        } else {
          window.localStorage.removeItem(recordsStorageKey);
        }
        return;
      } catch {
        window.localStorage.removeItem(recordsStorageKey);
      }
    }

    setRecords([]);
    setActiveRecordId(null);
  }, []);

  useEffect(() => {
    const handleThemeMenuPointer = (event: Event) => {
      const targetElement = event.target instanceof Element ? event.target : null;
      const themeButton = targetElement?.closest<HTMLButtonElement>("[data-theme-id]");
      const themeId = themeButton?.dataset.themeId as ThemeId | undefined;
      if (!themeId) {
        return;
      }

      event.stopPropagation();
      userSelectedThemeRef.current = true;
      setPreviewTheme(themeId);
      setActiveMenu(null);
    };

    document.addEventListener("pointerdown", handleThemeMenuPointer, true);
    document.addEventListener("mousedown", handleThemeMenuPointer, true);
    document.addEventListener("click", handleThemeMenuPointer, true);
    return () => {
      document.removeEventListener("pointerdown", handleThemeMenuPointer, true);
      document.removeEventListener("mousedown", handleThemeMenuPointer, true);
      document.removeEventListener("click", handleThemeMenuPointer, true);
    };
  }, []);

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

  function persistRecords(nextRecords: CorrectionRecord[]) {
    setRecords(nextRecords);
    if (nextRecords.length) {
      window.localStorage.setItem(recordsStorageKey, JSON.stringify(nextRecords));
    } else {
      window.localStorage.removeItem(recordsStorageKey);
    }
  }

  function applyConfig(nextConfig: PublicAppConfig) {
    setConfig(nextConfig);
    userSelectedThemeRef.current = false;
    setPreviewTheme(nextConfig.theme);
    setPreviewTypography(nextConfig.typography);
  }

  function openMenu(menuId: MenuId, event: React.MouseEvent) {
    event.stopPropagation();
    setActiveMenu(menuId);
  }

  function switchTheme(theme: ThemeId) {
    userSelectedThemeRef.current = true;
    setPreviewTheme(theme);
    setActiveMenu(null);
  }

  function closeSettings() {
    setPreviewTheme(config.theme);
    setPreviewTypography(config.typography);
    setSettingsOpen(false);
  }

  function closeSettingsAfterSave() {
    setSettingsOpen(false);
  }

  function resetWorkspace() {
    setActiveRecordId(null);
    setPendingMediaPath("");
    setWorkspaceError(null);
    setActiveMenu(null);
    setCorpusOpen(false);
  }

  function deleteRecord(recordId: string, event: React.MouseEvent) {
    event.stopPropagation();
    if (!window.confirm("确认要删除这条雅思口语评测记录吗？此操作无法撤销。")) {
      return;
    }

    const nextRecords = records.filter((record) => record.id !== recordId);
    persistRecords(nextRecords);
    if (activeRecordId === recordId) {
      setActiveRecordId(nextRecords[0]?.id ?? null);
    }
  }

  function addRecord(title: string, fileName: string, result: WorkspaceResult) {
    const now = new Date();
    const newRecord: CorrectionRecord = {
      id: `record-${Date.now()}`,
      title: title || "口语自主练习作业",
      date: formatRecordDate(now),
      fileName,
      duration: result.speechAssessment ? formatDuration(result.speechAssessment.durationMs / 1000) : "00:45",
      transcript: result.transcript,
      result,
    };
    const nextRecords = [newRecord, ...records];
    persistRecords(nextRecords);
    setActiveRecordId(newRecord.id);
  }

  async function importMediaFromMenu() {
    setActiveMenu(null);
    setActiveRecordId(null);
    setCorpusOpen(false);
    setWorkspaceError(null);

    try {
      const selectedPath = await selectMediaFile();
      if (selectedPath) {
        setPendingMediaPath(selectedPath);
      }
    } catch (error) {
      setWorkspaceError(error as AppError);
    }
  }

  async function submitTextForGrading(input: {
    answer: string;
    part: SpeakingPart;
    question: string;
    title: string;
    fileName: string;
  }) {
    if (!previewConfig.deepseek.apiKeyConfigured || !health) {
      setWorkspaceError({
        code: "GRADING_NOT_READY",
        message: !health ? "本地 Tauri 服务未连接。" : "请先在设置中保存 DeepSeek API Key。",
      });
      return;
    }

    setLoading(true);
    setWorkspaceError(null);
    try {
      const gradeResult = await gradeSpeaking({
        text: input.answer,
        part: input.part,
        question: input.question.trim() || undefined,
        ragExamples: [],
      });
      addRecord(input.title, input.fileName, mapGradeResultToWorkspaceResult(gradeResult, input.answer));
      setPendingMediaPath("");
    } catch (error) {
      setWorkspaceError(error as AppError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden text-text ${themeClass} ${typographyClass}`}>
      <MacMenuBar
        activeMenu={activeMenu}
        menuClock={menuClock}
        previewTheme={previewTheme}
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
              <HistorySidebar
                records={records}
                activeRecordId={activeRecordId}
                currentTheme={referenceTheme}
                corpusOpen={corpusOpen}
                onSelectRecord={(recordId) => {
                  setCorpusOpen(false);
                  setActiveRecordId(recordId);
                }}
                onDeleteRecord={deleteRecord}
                onNewSession={resetWorkspace}
                onOpenCorpus={() => {
                  setCorpusOpen(true);
                  setActiveRecordId(null);
                }}
              />
            </aside>

            <main className="relative flex min-w-0 flex-1 flex-col justify-between overflow-y-auto bg-transparent p-3 sm:p-5">
              {startupError || workspaceError ? (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
                  {(workspaceError ?? startupError)?.message}
                </div>
              ) : null}

              {corpusOpen ? (
                <CorpusPage />
              ) : (
                <Workspace
                  activeRecord={activeRecord}
                  config={previewConfig}
                  currentTheme={referenceTheme}
                  isLoading={loading}
                  pendingMediaPath={pendingMediaPath}
                  serviceReady={Boolean(health)}
                  onClearPendingMedia={() => setPendingMediaPath("")}
                  onAddRecord={addRecord}
                  onSubmitText={submitTextForGrading}
                />
              )}
            </main>
          </div>

          <footer className="window-statusbar">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`size-1.5 rounded-full ${health ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="truncate">{serviceLabel}</span>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <span>主题: {themeLabel}</span>
              <span>记录: {records.length}</span>
            </div>
          </footer>
        </div>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-[2147483002] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <SettingsPage
            config={config}
            onClose={closeSettings}
            onConfigChange={applyConfig}
            onSaved={closeSettingsAfterSave}
            onTypographyPreview={setPreviewTypography}
            onThemePreview={setPreviewTheme}
          />
        </div>
      ) : null}

      {helpOpen ? (
        <HelpModal currentTheme={referenceTheme} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

function MacMenuBar({
  activeMenu,
  menuClock,
  previewTheme,
  onOpenMenu,
  onOpenSettings,
  onOpenHelp,
  onReset,
  onImportMedia,
  onSwitchTheme,
}: {
  activeMenu: MenuId | null;
  menuClock: string;
  previewTheme: ThemeId;
  onOpenMenu: (menuId: MenuId, event: React.MouseEvent) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onReset: () => void;
  onImportMedia: () => void;
  onSwitchTheme: (theme: ThemeId) => void;
}) {
  return (
    <div className="mac-menu-bar">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        <button
          type="button"
          onClick={(event) => onOpenMenu("app", event)}
          className="mac-menu-trigger"
          aria-label="打开应用菜单"
        >
          <Apple size={15} />
        </button>

        <div className="relative">
          <button type="button" onMouseDown={(event) => onOpenMenu("app", event)} onClick={(event) => onOpenMenu("app", event)} className="mac-menu-title">
            IELTS Assessor
          </button>
          {activeMenu === "app" ? (
            <MenuPanel className="left-0">
              <MenuButton onClick={onOpenSettings} label="偏好设置..." shortcut="⌘," />
              <MenuDivider />
              <MenuButton onClick={onOpenHelp} label="关于 IELTS Assessor" />
            </MenuPanel>
          ) : null}
        </div>

        <div className="relative">
          <button type="button" onMouseDown={(event) => onOpenMenu("file", event)} onClick={(event) => onOpenMenu("file", event)} className="mac-menu-trigger">
            文件
          </button>
          {activeMenu === "file" ? (
            <MenuPanel className="left-0 w-56">
              <MenuButton onClick={onReset} label="新建批改会话 (重置)" />
              <MenuDivider />
              <MenuButton onClick={onImportMedia} label="导入音视频" shortcut="drag & drop" />
            </MenuPanel>
          ) : null}
        </div>

        <div className="relative">
          <button type="button" onMouseDown={(event) => onOpenMenu("themes", event)} onClick={(event) => onOpenMenu("themes", event)} className="mac-menu-trigger">
            主题切换
          </button>
          {activeMenu === "themes" ? (
            <MenuPanel className="left-0 w-56">
              <button type="button" data-theme-id="theme-claude" onClick={() => onSwitchTheme("theme-claude")} className="menu-item">
                <span>Claude 优雅主题</span>
                {previewTheme === "theme-claude" ? <span className="text-[10px] opacity-55">●</span> : null}
              </button>
              <button type="button" data-theme-id="theme-animal" onClick={() => onSwitchTheme("theme-animal")} className="menu-item">
                <span>动物森友会主题</span>
                {previewTheme === "theme-animal" ? <span className="text-[10px] opacity-55">●</span> : null}
              </button>
              <button type="button" data-theme-id="theme-glass" onClick={() => onSwitchTheme("theme-glass")} className="menu-item">
                <span>液态玻璃暗色主题</span>
                {previewTheme === "theme-glass" ? <span className="text-[10px] opacity-55">●</span> : null}
              </button>
            </MenuPanel>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <span className="hidden max-w-[180px] truncate font-mono text-[11px] opacity-60 md:inline">
          local@ielts-copilot
        </span>
        <Wifi size={14} className="opacity-75" />
        <Battery size={15} className="opacity-75" />
        <button type="button" onClick={onOpenSettings} className="mac-menu-icon" aria-label="打开设置">
          <Settings size={14} />
        </button>
        <button type="button" onClick={onOpenHelp} className="mac-menu-icon" aria-label="打开帮助">
          <HelpCircle size={14} />
        </button>
        <span className="tabular-nums font-semibold">{menuClock || "08:15"}</span>
      </div>
    </div>
  );
}

function HistorySidebar({
  records,
  activeRecordId,
  currentTheme,
  corpusOpen,
  onSelectRecord,
  onDeleteRecord,
  onNewSession,
  onOpenCorpus,
}: {
  records: CorrectionRecord[];
  activeRecordId: string | null;
  currentTheme: ReferenceTheme;
  corpusOpen: boolean;
  onSelectRecord: (recordId: string) => void;
  onDeleteRecord: (recordId: string, event: React.MouseEvent) => void;
  onNewSession: () => void;
  onOpenCorpus: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col justify-between p-3">
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1 opacity-70">
          <div className="flex items-center gap-1.5">
            <History size={14} />
            <span className="text-xs font-bold uppercase tracking-tight">历史批改记录</span>
          </div>
          <span className="rounded bg-current/10 px-1.5 py-0.5 font-mono text-[10px]">{records.length}</span>
        </div>

        <div className="space-y-1">
          <button
            type="button"
            onClick={onOpenCorpus}
            className={`history-row group ${corpusOpen ? `history-row-active history-row-active-${currentTheme}` : ""}`}
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <Database size={14} className="mt-0.5 shrink-0 opacity-70" />
              <div className="min-w-0 flex-1 text-left leading-snug">
                <p className="truncate text-[11px] font-semibold">教师案例库</p>
                <p className="mt-0.5 text-[10px] opacity-50">SQLite CRUD 基础</p>
              </div>
            </div>
          </button>

          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-1 px-4 py-8 text-center text-[10px] opacity-40">
              <HardDrive size={24} className="mb-1 stroke-1" />
              <span>暂无历史口语作业</span>
              <span>录入文本批改后会保存记录</span>
            </div>
          ) : (
            records.map((record) => {
              const selected = record.id === activeRecordId;
              const isMedia = record.fileName !== "Typed Input";
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => onSelectRecord(record.id)}
                  className={`history-row group ${selected ? `history-row-active history-row-active-${currentTheme}` : ""}`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0 opacity-70">
                      {isMedia ? <FileAudio size={14} /> : <FileText size={14} />}
                    </div>
                    <div className="min-w-0 flex-1 text-left leading-snug">
                      <p className="truncate text-[11px] font-semibold" title={record.title}>
                        {record.title}
                      </p>
                      <p className="mt-0.5 text-[10px] opacity-50">{record.date}</p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded bg-current/10 px-1 py-0.5 font-mono text-[10px] font-bold">
                      B {record.result.overallScore.toFixed(1)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => onDeleteRecord(record.id, event)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          onDeleteRecord(record.id, event as unknown as React.MouseEvent);
                        }
                      }}
                      className="rounded p-0.5 text-red-500 opacity-0 transition-all hover:bg-red-500/10 group-hover:opacity-100"
                      title="删除记录"
                    >
                      <Trash2 size={12} />
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="mt-3 shrink-0 border-t border-current/10 pt-3">
        <button type="button" onClick={onNewSession} className="new-session-button">
          <Plus size={14} />
          <span>新口语作业批改</span>
        </button>
      </div>
    </div>
  );
}

function Workspace({
  activeRecord,
  config,
  currentTheme,
  isLoading,
  pendingMediaPath,
  serviceReady,
  onClearPendingMedia,
  onAddRecord,
  onSubmitText,
}: {
  activeRecord: CorrectionRecord | null;
  config: PublicAppConfig;
  currentTheme: ReferenceTheme;
  isLoading: boolean;
  pendingMediaPath: string;
  serviceReady: boolean;
  onClearPendingMedia: () => void;
  onAddRecord: (title: string, fileName: string, result: WorkspaceResult) => void;
  onSubmitText: (input: {
    answer: string;
    part: SpeakingPart;
    question: string;
    title: string;
    fileName: string;
  }) => Promise<void>;
}) {
  const [inputMode, setInputMode] = useState<InputMode>("media");
  const [customTitle, setCustomTitle] = useState("");
  const [question, setQuestion] = useState("Describe a happy event in your childhood");
  const [part, setPart] = useState<SpeakingPart>("part2");
  const [textInput, setTextInput] = useState("");
  const [mediaPath, setMediaPath] = useState("");
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(null);
  const [mediaTranscodeResult, setMediaTranscodeResult] = useState<MediaTranscodeResult | null>(null);
  const [speechAssessmentResult, setSpeechAssessmentResult] = useState<SpeechAssessmentResult | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaPreviewOnly, setMediaPreviewOnly] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<AppError | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>("overall");
  const [resultSelectorOpen, setResultSelectorOpen] = useState(false);
  const [resultSelectorDismissed, setResultSelectorDismissed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const browserFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const activeWordTokenIdRef = useRef<string | null>(null);
  const wordTokenElementRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const resultSelectorHoverTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingMediaPath) {
      void loadMediaPath(pendingMediaPath);
    }
  }, [pendingMediaPath]);

  useEffect(() => {
    if (activeRecord) {
      setActiveTab("overall");
      setResultSelectorOpen(false);
      setResultSelectorDismissed(false);
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [activeRecord]);

  useEffect(() => {
    return () => {
      if (resultSelectorHoverTimerRef.current !== null) {
        window.clearTimeout(resultSelectorHoverTimerRef.current);
      }
    };
  }, []);

  const cardClass = getCardClass(currentTheme);
  const accentClass = getAccentButtonClass(currentTheme);
  const secondaryClass = getSecondaryButtonClass(currentTheme);
  const displayedResult = activeRecord?.result ?? null;
  const displayedTranscript = displayedResult?.transcript ?? activeRecord?.transcript ?? [];
  const displayedTranscriptTokens = displayedResult?.transcriptTokens ?? [];
  const displayedTitle = activeRecord?.title ?? "雅思口语作业批改";
  const answerLength = textInput.trim().length;
  const canSubmitText = serviceReady && config.deepseek.apiKeyConfigured && answerLength >= 20 && !isLoading;
  const mediaPlayerUrl = useMemo(
    () => (mediaTranscodeResult ? convertFileSrc(mediaTranscodeResult.outputPath) : null),
    [mediaTranscodeResult],
  );
  const canStartMediaCorrection =
    Boolean(mediaPath.trim()) && Boolean(mediaMetadata?.supported) && !mediaBusy && !mediaPreviewOnly;
  const resultTabOptions = displayedResult
    ? [
        { id: "overall" as const, name: "综合批语" },
        { id: "fluency" as const, name: `流利度 (${displayedResult.fluencyScore.score})` },
        { id: "lexical" as const, name: `词汇 (${displayedResult.lexicalScore.score})` },
        { id: "grammar" as const, name: `语法 (${displayedResult.grammarScore.score})` },
        { id: "pronunciation" as const, name: `发音 (${displayedResult.pronunciationScore.score})` },
        { id: "corrections" as const, name: `病句修正 (${displayedResult.keyCorrections.length})` },
      ]
    : [];
  const activeResultTabName = resultTabOptions.find((tabOption) => tabOption.id === activeTab)?.name ?? "综合批语";

  async function chooseMediaFileFromDialog() {
    setInputMode("media");
    setMediaError(null);
    setMediaNotice(null);
    if (!isTauriRuntimeAvailable()) {
      browserFileInputRef.current?.click();
      return;
    }

    try {
      const selectedPath = await selectMediaFile();
      if (selectedPath) {
        await loadMediaPath(selectedPath);
      }
    } catch (error) {
      setMediaError(error as AppError);
    }
  }

  async function loadMediaPath(nextMediaPath: string) {
    const normalizedMediaPath = nextMediaPath.trim();
    setInputMode("media");
    setMediaPath(normalizedMediaPath);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(false);
    setMediaNotice(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);

    if (!normalizedMediaPath) {
      setMediaMetadata(null);
      setMediaNotice(null);
      setMediaError({
        code: "MEDIA_PATH_EMPTY",
        message: "请先选择或拖入一个媒体文件。",
      });
      return;
    }

    setMediaBusy(true);
    setMediaError(null);
    try {
      const nextMetadata = await getMediaMetadata(normalizedMediaPath);
      setMediaMetadata(nextMetadata);
      if (!nextMetadata.supported) {
        setMediaError({
          code: "MEDIA_UNSUPPORTED_TYPE",
          message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
        });
      }
    } catch (error) {
      setMediaMetadata(null);
      setMediaNotice(null);
      setMediaError(error as AppError);
    } finally {
      setMediaBusy(false);
    }
  }

  async function startMediaAiCorrection() {
    const normalizedMediaPath = mediaPath.trim();
    if (!normalizedMediaPath || !mediaMetadata?.supported) {
      return;
    }

    setMediaBusy(true);
    setMediaNotice(null);
    setMediaError(null);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    try {
      const nextResult = await transcodeMedia({ inputPath: normalizedMediaPath });
      setMediaTranscodeResult(nextResult);
      setMediaMetadata(await getMediaMetadata(normalizedMediaPath));
      setMediaNotice("音视频已转码为标准 WAV，正在提交 Azure 进行长音频发音评估。");
      const azureConfigValidationResult = await validateAzureConfig();
      if (!azureConfigValidationResult.ok) {
        setMediaNotice(null);
        setMediaError({
          code: "AZURE_CONFIG_INVALID",
          message: azureConfigValidationResult.message,
        });
        return;
      }

      const nextSpeechAssessmentResult = await assessPronunciation({
        wavPath: nextResult.outputPath,
        referenceText: question.trim() || undefined,
      });
      setSpeechAssessmentResult(nextSpeechAssessmentResult);
      const workspaceResult = mapSpeechAssessmentToWorkspaceResult(nextSpeechAssessmentResult);
      onAddRecord(
        customTitle.trim() || question.trim() || getFileNameFromPath(normalizedMediaPath).replace(/\.[^/.]+$/, ""),
        mediaMetadata?.fileName ?? getFileNameFromPath(normalizedMediaPath),
        workspaceResult,
      );
      setMediaNotice("Azure 长音频发音评估完成，已生成真实 transcript 和发音报告。");
    } catch (error) {
      setMediaError(error as AppError);
    } finally {
      setMediaBusy(false);
    }
  }

  function handleDroppedFile(file: File) {
    const droppedPath = getLocalFilePath(file);
    if (!droppedPath) {
      if (!isTauriRuntimeAvailable()) {
        loadBrowserPreviewFile(file);
      } else {
        setMediaNotice(null);
        setMediaError({
          code: "MEDIA_DROP_PATH_UNAVAILABLE",
          message: "无法从拖拽文件读取本地路径，请使用“手动浏览文件”按钮。",
        });
      }
      return;
    }

    void loadMediaPath(droppedPath);
  }

  function loadBrowserPreviewFile(file: File) {
    const extension = getFileExtension(file.name);
    const supported = isSupportedMediaExtension(extension);
    setInputMode("media");
    setMediaPath(file.name);
    setMediaMetadata({
      path: file.name,
      fileName: file.name,
      extension,
      sizeBytes: file.size,
      supported,
    });
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(true);
    setMediaBusy(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);

    if (supported) {
      setMediaError(null);
      setMediaNotice("网页预览已读取文件信息；真实 FFmpeg 转码需要在 Tauri 桌面端运行。");
    } else {
      setMediaNotice(null);
      setMediaError({
        code: "MEDIA_UNSUPPORTED_TYPE",
        message: "仅支持 MP4、MP3、M4A 和 WAV 文件。",
      });
    }
  }

  function openResultSelectorAfterDelay() {
    if (resultSelectorHoverTimerRef.current !== null) {
      window.clearTimeout(resultSelectorHoverTimerRef.current);
    }

    resultSelectorHoverTimerRef.current = window.setTimeout(() => {
      setResultSelectorDismissed(false);
      setResultSelectorOpen(true);
      resultSelectorHoverTimerRef.current = null;
    }, 300);
  }

  function closeResultSelector() {
    if (resultSelectorHoverTimerRef.current !== null) {
      window.clearTimeout(resultSelectorHoverTimerRef.current);
      resultSelectorHoverTimerRef.current = null;
    }
    setResultSelectorOpen(false);
    setResultSelectorDismissed(false);
  }

  function chooseResultTab(nextResultTab: ResultTab) {
    setActiveTab(nextResultTab);
    if (resultSelectorHoverTimerRef.current !== null) {
      window.clearTimeout(resultSelectorHoverTimerRef.current);
      resultSelectorHoverTimerRef.current = null;
    }
    setResultSelectorOpen(false);
    setResultSelectorDismissed(true);
  }

  function clearSelectedMedia() {
    setMediaPath("");
    setMediaMetadata(null);
    setMediaTranscodeResult(null);
    setSpeechAssessmentResult(null);
    setMediaPreviewOnly(false);
    setMediaNotice(null);
    setMediaError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    onClearPendingMedia();
  }

  async function submitCorrection() {
    const title =
      customTitle.trim() ||
      question.trim() ||
      (mediaMetadata?.fileName ?? getFileNameFromPath(mediaPath)).replace(/\.[^/.]+$/, "") ||
      "IELTS 口语练习";

    if (inputMode === "media") {
      await startMediaAiCorrection();
      return;
    }

    await onSubmitText({
      answer: textInput,
      part,
      question,
      title,
      fileName: "Typed Input",
    });
    setTextInput("");
    setCustomTitle("");
  }

  function togglePlayback() {
    if (!audioPlayerRef.current) {
      return;
    }

    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
      return;
    }

    audioPlayerRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }

  function jumpToTimestamp(seconds: number) {
    if (!audioPlayerRef.current) {
      return;
    }

    audioPlayerRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    void audioPlayerRef.current.play();
    setIsPlaying(true);
  }

  const currentScoreData = getScoreData(displayedResult, activeTab);
  const currentWordToken = findCurrentWordToken(displayedTranscriptTokens, currentTime);

  useEffect(() => {
    const previousActiveWordTokenId = activeWordTokenIdRef.current;
    if (previousActiveWordTokenId) {
      wordTokenElementRefs.current[previousActiveWordTokenId]?.classList.remove("transcript-word-active");
    }

    if (currentWordToken?.type === "word") {
      wordTokenElementRefs.current[currentWordToken.id]?.classList.add("transcript-word-active");
      activeWordTokenIdRef.current = currentWordToken.id;
    } else {
      activeWordTokenIdRef.current = null;
    }
  }, [currentWordToken?.id]);

  return (
    <div className="flex min-h-full w-full flex-col space-y-4 min-[1180px]:h-full">
      <div className="grid grid-cols-1 gap-5 min-[1180px]:min-h-0 min-[1180px]:flex-1 min-[1180px]:grid-cols-12">
        <div className="flex flex-col space-y-4 min-[1180px]:col-span-5 min-[1180px]:min-h-0">
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-1 text-xs font-bold uppercase tracking-tight opacity-70">
              <span>作业导入与文本批改</span>
            </h3>
            <div className="flex rounded-lg bg-current/5 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setInputMode("media")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${inputMode === "media" ? accentClass : "opacity-60 hover:opacity-100"}`}
              >
                音视频录传
              </button>
              <button
                type="button"
                onClick={() => setInputMode("text")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${inputMode === "text" ? accentClass : "opacity-60 hover:opacity-100"}`}
              >
                手工手写文本
              </button>
            </div>
          </div>

          <div className={`${cardClass} relative flex min-h-[340px] flex-col justify-between space-y-4 p-4 min-[1180px]:flex-1`}>
            {dragging ? (
              <div className="absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-500/10 backdrop-blur-sm">
                <div className="space-y-1 text-center">
                  <Upload size={36} className="mx-auto text-indigo-500" />
                  <p className="text-sm font-bold">释放文件导入到工作区</p>
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60">
                作业标题 (可选)
              </label>
              <input
                type="text"
                placeholder="例如: Part 2 科技对生活的影响"
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                className="workspace-input"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[112px_minmax(0,1fr)]">
              <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wider opacity-70">
                考试部分
                <select
                  value={part}
                  onChange={(event) => setPart(event.target.value as SpeakingPart)}
                  className="workspace-input text-xs font-normal normal-case"
                >
                  <option value="part1">Part 1</option>
                  <option value="part2">Part 2</option>
                  <option value="part3">Part 3</option>
                </select>
              </label>
              <label className="grid min-w-0 gap-1 text-[10px] font-bold uppercase tracking-wider opacity-70">
                题目
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="workspace-input text-xs font-normal normal-case"
                />
              </label>
            </div>

            <div className="flex flex-1 flex-col justify-center py-2">
              {inputMode === "media" ? (
                <div className="flex flex-col space-y-4">
                  <div
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      setDragging(false);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      const file = event.dataTransfer.files.item(0);
                      if (file) {
                        handleDroppedFile(file);
                      }
                    }}
                    className="workspace-file-dropzone flex flex-col items-center justify-center space-y-2 rounded-xl border-2 border-dashed border-current/20 bg-current/[0.01] p-6 text-center transition hover:border-current/40"
                  >
                    {mediaPath ? (
                      <div className="flex w-full max-w-md flex-col items-center gap-4">
                        <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-left">
                          <div className="flex min-w-0 items-center gap-3">
                            {isVideoPath(mediaMetadata?.fileName ?? mediaPath) ? (
                              <FileVideo size={22} className="shrink-0 text-emerald-500" />
                            ) : (
                              <FileAudio size={22} className="shrink-0 text-emerald-500" />
                            )}
                            <div className="min-w-0 leading-tight">
                              <p className="truncate text-sm font-bold text-emerald-600">
                                {mediaMetadata?.fileName ?? getFileNameFromPath(mediaPath)}
                              </p>
                              <p className="mt-1 text-[10px] opacity-60">
                                {mediaMetadata
                                  ? `${formatBytes(mediaMetadata.sizeBytes)} / ${mediaMetadata.supported ? "格式可转码" : "格式不支持"}`
                                  : mediaBusy
                                    ? "正在读取文件信息"
                                    : "等待检查文件信息"}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={clearSelectedMedia}
                            className="shrink-0 rounded bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-600 hover:bg-red-200"
                          >
                            清空
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void chooseMediaFileFromDialog()}
                          disabled={mediaBusy}
                          className={`rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${secondaryClass}`}
                        >
                          更换文件
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload size={28} className="opacity-60" />
                        <div>
                          <p className="text-xs font-semibold">拖拽音频或视频文件至此处</p>
                          <p className="mt-1 text-[10px] opacity-50">支持 MP4, MP3, M4A, WAV；转码为 16kHz 16bit mono PCM</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void chooseMediaFileFromDialog()}
                          disabled={mediaBusy}
                          className={`rounded px-2 py-1 text-[10px] font-bold disabled:opacity-50 ${secondaryClass}`}
                        >
                          手动浏览文件
                        </button>
                      </>
                    )}
                    <input
                      ref={browserFileInputRef}
                      type="file"
                      accept=".mp4,.mp3,.m4a,.wav,audio/mp4,audio/mpeg,audio/wav,video/mp4"
                      className="hidden"
                      onChange={(event) => {
                        const selectedFile = event.target.files?.item?.(0) ?? event.target.files?.[0];
                        if (selectedFile) {
                          loadBrowserPreviewFile(selectedFile);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </div>

                  {mediaTranscodeResult ? (
                    <div className="space-y-2 rounded-lg border border-current/10 bg-current/[0.02] p-3 text-[10px] leading-4">
                      <div className="font-bold text-emerald-600">转码完成</div>
                      <div className="break-all opacity-70">输出路径：{mediaTranscodeResult.outputPath}</div>
                      <div className="opacity-70">
                        格式：WAV / {mediaTranscodeResult.sampleRate} Hz / {mediaTranscodeResult.channels} channel / {mediaTranscodeResult.codec}
                      </div>
                    </div>
                  ) : null}

                  {speechAssessmentResult ? (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-[10px] leading-4 text-emerald-700">
                      <div className="font-bold">Azure 语音评估完成</div>
                      <div className="mt-1 opacity-80">
                        Pronunciation {formatOptionalScore(speechAssessmentResult.overall.pronunciationScore)} / Accuracy{" "}
                        {formatOptionalScore(speechAssessmentResult.overall.accuracyScore)}
                      </div>
                    </div>
                  ) : null}

                  {mediaNotice ? (
                    <div className="rounded-lg border border-current/10 bg-current/[0.04] p-2.5 text-[10px] font-semibold leading-4 opacity-70">
                      {mediaNotice}
                    </div>
                  ) : null}

                  {mediaError ? (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2.5 text-[10px] font-semibold leading-4 text-red-600">
                      {mediaError.message}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full flex-col space-y-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider opacity-60">
                    写入您的雅思答题脚本
                  </label>
                  <textarea
                    placeholder="复制粘贴或手写录入您的答题原稿内容..."
                    value={textInput}
                    onChange={(event) => setTextInput(event.target.value)}
                    className="workspace-textarea"
                  />
                  <span className="text-[10px] opacity-50">当前长度：{answerLength} 字符；至少 20 字符后可提交。</span>
                </div>
              )}
            </div>

            <div className="border-t border-current/10 pt-3">
              <button
                type="button"
                onClick={() => void submitCorrection()}
                disabled={inputMode === "text" ? isLoading || !canSubmitText : mediaBusy || !canStartMediaCorrection}
                className={`flex w-full items-center justify-center gap-1.5 rounded py-2.5 text-xs font-bold shadow-md transition disabled:opacity-50 ${accentClass}`}
              >
                {inputMode === "media" && mediaBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : inputMode === "media" ? (
                  <FileAudio size={14} />
                ) : (
                  <Sparkles size={14} className={isLoading ? "animate-spin" : ""} />
                )}
                <span>
                  {inputMode === "media"
                    ? mediaBusy
                      ? mediaTranscodeResult
                        ? "Azure 发音评估中..."
                        : "转码中..."
                      : "开始 AI 作业批改"
                    : isLoading
                      ? "考官 AI 精审分析中..."
                      : "开始 DeepSeek 文本批改"}
                </span>
              </button>
              {inputMode === "text" && !canSubmitText ? (
                <p className="mt-2 text-[10px] leading-4 opacity-55">
                  {!serviceReady ? "本地服务未连接。" : !config.deepseek.apiKeyConfigured ? "请先配置 DeepSeek Key。" : "请输入至少 20 字符。"}
                </p>
              ) : null}
              {inputMode === "media" && !canStartMediaCorrection ? (
                <p className="mt-2 text-[10px] leading-4 opacity-55">
                  {!mediaPath
                    ? "请先选择或拖入 MP4、MP3、M4A、WAV 文件。"
                    : mediaPreviewOnly
                      ? "网页预览只能读取文件信息；真实转码请使用 Tauri 桌面端。"
                      : mediaMetadata && !mediaMetadata.supported
                        ? "当前格式不支持转码。"
                        : "请等待文件检查完成。"}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col space-y-4 min-[1180px]:col-span-7 min-[1180px]:min-h-0">
          <div className="flex min-h-8 items-center justify-between">
            <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-bold uppercase tracking-tight opacity-70">
              <span className="truncate">口语批改工作区 - {displayedTitle}</span>
            </h3>
          </div>

          {!displayedResult ? (
            <div className={`${cardClass} flex min-h-[400px] flex-col items-center justify-center space-y-4 p-8 text-center min-[1180px]:flex-1`}>
              <div className="rounded-full bg-current/5 p-4">
                <FileAudio size={42} className="opacity-50" />
              </div>
              <div className="max-w-md space-y-2">
                <h4 className="text-sm font-bold tracking-tight">等待上传雅思口语作业</h4>
                <p className="text-xs leading-relaxed opacity-60">
                  左侧菜单会沉淀真实批改档案。导入媒体后会完成标准 WAV 转码和 Azure 长音频发音评估；录入文本后可查看四项评分、词汇修正和高分重构。
                </p>
                <div className="grid grid-cols-3 gap-2 pt-4">
                  <GuideCard title="1. 媒体转码" text="输出 16kHz 单声道 WAV。" />
                  <GuideCard title="2. Azure 发音评估" text="逐词评分与停顿。" />
                  <GuideCard title="3. 播放同步" text="点击词跳转音频。" />
                </div>
              </div>
              {mediaPlayerUrl ? (
                <div className="w-full max-w-xl rounded-xl border border-current/10 bg-current/[0.02] p-3 text-left">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={togglePlayback}
                        className={`shrink-0 rounded-full p-2.5 text-white ${accentClass}`}
                      >
                        {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                      </button>
                      <div className="leading-tight">
                        <p className="max-w-[260px] truncate text-[11px] font-bold">转码 WAV 播放器</p>
                        <p className="text-[10px] opacity-50">当前播放的是 FFmpeg 输出的标准 WAV 文件。</p>
                      </div>
                    </div>
                    <div className="flex max-w-md flex-1 items-center gap-2">
                      <span className="font-mono text-[10px] tabular-nums opacity-50">
                        {formatDuration(currentTime)}
                      </span>
                      <input
                        type="range"
                        min="0"
                        max={audioDuration || 60}
                        step="0.1"
                        value={currentTime}
                        onChange={(event) => {
                          const seconds = Number(event.target.value);
                          setCurrentTime(seconds);
                          if (audioPlayerRef.current) {
                            audioPlayerRef.current.currentTime = seconds;
                          }
                        }}
                        className="w-full accent-current"
                      />
                      <span className="font-mono text-[10px] tabular-nums opacity-50">
                        {formatDuration(audioDuration || 60)}
                      </span>
                    </div>
                    <audio
                      ref={audioPlayerRef}
                      src={mediaPlayerUrl}
                      onTimeUpdate={() => setCurrentTime(audioPlayerRef.current?.currentTime ?? 0)}
                      onLoadedMetadata={() => setAudioDuration(audioPlayerRef.current?.duration ?? 0)}
                      onEnded={() => setIsPlaying(false)}
                    >
                      <track kind="captions" />
                    </audio>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col space-y-4 min-[1180px]:min-h-0 min-[1180px]:flex-1">
              <div className={`${cardClass} shrink-0 p-3`}>
                <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border border-current/10 bg-current/5">
                      <span className="font-mono text-[9px] font-bold uppercase leading-none opacity-50">Band</span>
                      <span className="mt-0.5 font-mono text-xl font-bold leading-none tracking-tight">
                        {displayedResult.overallScore.toFixed(1)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold leading-snug">雅思口语专家评分</h4>
                      <p className="mt-0.5 max-w-[280px] truncate text-[10px] leading-normal opacity-60">
                        由 {config.deepseek.model} 大模型精细评估
                      </p>
                    </div>
                  </div>

                  <div
                    className="result-selector"
                    onMouseEnter={openResultSelectorAfterDelay}
                    onMouseLeave={closeResultSelector}
                    onFocus={openResultSelectorAfterDelay}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        closeResultSelector();
                      }
                    }}
                  >
                    <button
                      type="button"
                      className={`result-selector-trigger result-tab-active-${currentTheme}`}
                      aria-haspopup="listbox"
                      aria-expanded={resultSelectorOpen}
                      onClick={() => {
                        setResultSelectorDismissed(false);
                        setResultSelectorOpen((current) => !current);
                      }}
                    >
                      <span className="truncate">{activeResultTabName}</span>
                      <span className="result-selector-chevron" aria-hidden="true">
                        <ChevronDown size={12} strokeWidth={2.5} />
                      </span>
                    </button>

                    <div
                      className={`result-selector-menu ${resultSelectorOpen ? "result-selector-menu-open" : ""} ${
                        resultSelectorDismissed ? "result-selector-menu-dismissed" : ""
                      }`}
                      role="listbox"
                      aria-label="选择评分维度"
                    >
                      {resultTabOptions.map((tabOption) => (
                        <button
                          key={tabOption.id}
                          type="button"
                          role="option"
                          aria-selected={activeTab === tabOption.id}
                          onClick={() => chooseResultTab(tabOption.id)}
                          className={`result-selector-option ${
                            activeTab === tabOption.id ? `result-selector-option-active result-selector-option-active-${currentTheme}` : ""
                          }`}
                        >
                          {tabOption.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className={`${cardClass} p-4 text-xs leading-relaxed min-[1180px]:min-h-0 min-[1180px]:flex-1 min-[1180px]:overflow-y-auto`}>
                {activeTab === "overall" ? (
                  <div className="space-y-4">
                    <div>
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-50">
                        总评与复盘建议
                      </span>
                      <p className="whitespace-pre-line leading-relaxed">{displayedResult.generalFeedback}</p>
                    </div>

                    {displayedTranscriptTokens.length > 0 ? (
                      <div className="border-t border-current/10 pt-4">
                        <span className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-50">
                          <CheckCircle2 size={12} className={currentTheme === "claude" ? "text-[#F27D26]" : "text-emerald-500"} />
                          <span>逐词 transcript 与播放同步 (点击单词跳转)</span>
                        </span>
                        <TranscriptTokenPanel
                          tokens={displayedTranscriptTokens}
                          wordTokenElementRefs={wordTokenElementRefs}
                          onJumpToTimestamp={jumpToTimestamp}
                        />
                      </div>
                    ) : displayedTranscript.length > 0 ? (
                      <div className="border-t border-current/10 pt-4">
                        <span className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-50">
                          <CheckCircle2 size={12} className={currentTheme === "claude" ? "text-[#F27D26]" : "text-emerald-500"} />
                          <span>逐字还原语料及句级时间戳跳转 (点击跳转音频)</span>
                        </span>
                        <div className="max-h-[190px] space-y-2.5 overflow-y-auto rounded-xl border border-current/10 bg-current/[0.02] p-4">
                          {displayedTranscript.map((chunk) => (
                            <button
                              key={`${chunk.timestamp}-${chunk.text}`}
                              type="button"
                              onClick={() => jumpToTimestamp(chunk.seconds)}
                              className="group flex w-full items-start gap-2.5 rounded p-1 text-left transition hover:bg-current/5"
                            >
                              <span className="mt-0.5 flex shrink-0 items-center font-mono text-[10px] font-bold opacity-60 group-hover:opacity-100">
                                <Clock size={10} className="mr-0.5" />
                                {chunk.timestamp}
                              </span>
                              <span className="leading-relaxed hover:underline">{chunk.text}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <span className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                        <Bookmark size={12} />
                        <span>考官推荐高分示范回答</span>
                      </span>
                      <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-3 font-serif text-[11px] italic leading-relaxed text-emerald-700">
                        "{displayedResult.modelAnswer}"
                      </div>
                    </div>
                  </div>
                ) : null}

                {currentScoreData ? (
                  <CriterionPanel activeTab={activeTab} scoreData={currentScoreData} />
                ) : null}

                {activeTab === "corrections" ? (
                  <CorrectionsPanel corrections={displayedResult.keyCorrections} />
                ) : null}
              </div>

              {mediaPlayerUrl ? (
                <div className={`${cardClass} shrink-0 p-3`}>
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={togglePlayback}
                        className={`shrink-0 rounded-full p-2.5 text-white ${accentClass}`}
                      >
                        {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                      </button>
                      <div className="leading-tight">
                        <p className="max-w-[200px] truncate text-[11px] font-bold">口语练习音频播放器</p>
                        <p className="text-[10px] opacity-50">播放转码后的 WAV 文件；Azure continuous mode 评估结果可点击词级 transcript 回听。</p>
                      </div>
                    </div>
                    <div className="flex max-w-md flex-1 items-center gap-2">
                      <span className="font-mono text-[10px] tabular-nums opacity-50">
                        {formatDuration(currentTime)}
                      </span>
                      <input
                        type="range"
                        min="0"
                        max={audioDuration || 60}
                        step="0.1"
                        value={currentTime}
                        onChange={(event) => {
                          const seconds = Number(event.target.value);
                          setCurrentTime(seconds);
                          if (audioPlayerRef.current) {
                            audioPlayerRef.current.currentTime = seconds;
                          }
                        }}
                        className="w-full accent-current"
                      />
                      <span className="font-mono text-[10px] tabular-nums opacity-50">
                        {formatDuration(audioDuration || 60)}
                      </span>
                    </div>
                    <audio
                      ref={audioPlayerRef}
                      src={mediaPlayerUrl}
                      onTimeUpdate={() => setCurrentTime(audioPlayerRef.current?.currentTime ?? 0)}
                      onLoadedMetadata={() => setAudioDuration(audioPlayerRef.current?.duration ?? 0)}
                      onEnded={() => setIsPlaying(false)}
                    >
                      <track kind="captions" />
                    </audio>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-1 rounded-lg bg-current/5 p-2.5 text-left">
      <span className="block text-[10px] font-bold">{title}</span>
      <span className="block text-[9px] leading-tight opacity-60">{text}</span>
    </div>
  );
}

function CriterionPanel({ activeTab, scoreData }: { activeTab: ResultTab; scoreData: ScoreCriterion }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-current/10 pb-2 opacity-80">
        <span className="font-bold">{getSubcategoryName(activeTab)}</span>
        <span className={`rounded-full px-2.5 py-0.5 font-mono text-xs font-bold ${getScoreBadge(scoreData.score)}`}>
          分值: {scoreData.score}
        </span>
      </div>
      <div>
        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-50">标准评语</span>
        <p className="whitespace-pre-line leading-relaxed">{scoreData.feedback}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-3">
          <span className="mb-1.5 block text-[10px] font-bold uppercase text-emerald-500">突出亮点</span>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-emerald-700">
            {scoreData.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-amber-500/10 bg-amber-500/5 p-3">
          <span className="mb-1.5 block text-[10px] font-bold uppercase text-amber-500">改进方向</span>
          <ul className="list-disc space-y-1 pl-4 text-[11px] text-amber-700">
            {scoreData.improvements.map((improvement) => (
              <li key={improvement}>{improvement}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CorrectionsPanel({ corrections }: { corrections: SentenceCorrection[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-current/10 pb-2 opacity-80">
        <span className="font-bold">病句修正及高分重构</span>
        <span className="rounded bg-red-400/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-red-500">
          解析: {corrections.length} 处
        </span>
      </div>
      {corrections.length === 0 ? (
        <div className="py-10 text-center opacity-40">AI Examiner 暂未挑出明显词法或语法问题。</div>
      ) : (
        <div className="space-y-3.5">
          {corrections.map((correction) => (
            <div key={`${correction.original}-${correction.improved}`} className="space-y-2 rounded-lg border border-current/10 bg-current/[0.02] p-3">
              <div className="flex items-center gap-2">
                <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${getCorrectionBadge(correction.category)}`}>
                  {getCorrectionLabel(correction.category)}
                </span>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 leading-relaxed md:grid-cols-12">
                <div className="rounded border border-red-500/10 bg-red-500/5 p-2 text-[11px] text-red-700 md:col-span-5">
                  <span className="mb-0.5 block font-sans text-[9px] font-bold uppercase opacity-40">您的口语答复 Draft</span>
                  "{correction.original}"
                </div>
                <div className="flex items-center justify-center opacity-40 md:col-span-1">
                  <ArrowRight size={14} className="rotate-90 md:rotate-0" />
                </div>
                <div className="rounded border border-emerald-500/10 bg-emerald-500/5 p-2 text-[11px] font-semibold text-emerald-700 md:col-span-6">
                  <span className="mb-0.5 block font-sans text-[9px] font-bold uppercase opacity-40">考官级高级示范</span>
                  "{correction.improved}"
                </div>
              </div>
              <div className="flex items-start gap-1.5 pl-1 pt-0.5 text-[10px] leading-relaxed opacity-80">
                <CornerDownRight size={12} className="mt-0.5 shrink-0" />
                <p>
                  <span className="font-semibold opacity-70">名师答疑/提分点: </span>
                  {correction.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptTokenPanel({
  tokens,
  wordTokenElementRefs,
  onJumpToTimestamp,
}: {
  tokens: TranscriptToken[];
  wordTokenElementRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onJumpToTimestamp: (seconds: number) => void;
}) {
  return (
    <div className="max-h-[220px] overflow-y-auto rounded-xl border border-current/10 bg-current/[0.02] p-4 leading-8">
      {tokens.map((token) => {
        if (token.type === "pause") {
          return (
            <span key={token.id} className="mx-1 rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
              [Pause: {(token.durationMs / 1000).toFixed(1)}s]
            </span>
          );
        }

        const isLowAccuracy = token.accuracyScore !== undefined && token.accuracyScore < lowAccuracyThreshold;
        const tooltipParts = [
          token.accuracyScore === undefined ? "" : `Accuracy: ${token.accuracyScore.toFixed(1)}`,
          ...(token.phonemeErrors ?? []),
        ].filter(Boolean);

        return (
          <button
            key={token.id}
            ref={(element) => {
              wordTokenElementRefs.current[token.id] = element;
            }}
            type="button"
            title={tooltipParts.join("\n")}
            onClick={() => onJumpToTimestamp(token.startMs / 1000)}
            className={`transcript-word mx-0.5 rounded px-1 py-0.5 transition hover:bg-current/10 ${
              isLowAccuracy ? "text-red-600 underline decoration-red-500 decoration-2 underline-offset-4" : ""
            }`}
          >
            {token.text}
          </button>
        );
      })}
    </div>
  );
}

function HelpModal({ currentTheme, onClose }: { currentTheme: ReferenceTheme; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2147483001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className={`${getCardClass(currentTheme)} relative max-w-md p-6 text-xs`}>
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-muted hover:text-text" aria-label="关闭帮助">
          <X size={18} />
        </button>
        <h3 className="mb-3 flex items-center gap-1 text-sm font-bold tracking-tight">
          <BookOpen size={16} />
          <span>雅思口语提分大师批改小手册</span>
        </h3>
        <div className="space-y-3 text-left leading-relaxed opacity-90">
          <p>本界面严格采用参考项目的 macOS 工作台结构：菜单栏、历史侧栏、双栏工作区、报告 tabs 和底部状态栏。</p>
          <p>文件菜单可新建会话或导入音视频，主题切换可在 Claude、动物森友会和液态玻璃之间即时预览。</p>
          <p>当前可用链路包括 DeepSeek 文本批改、媒体转码和 Azure Speech SDK 长音频发音评估；真实 Azure Key 验证暂缓到人工验收阶段。</p>
        </div>
        <div className="mt-5 flex justify-end border-t border-current/10 pt-3">
          <button type="button" onClick={onClose} className={`rounded px-3.5 py-1.5 text-xs font-semibold ${getAccentButtonClass(currentTheme)}`}>
            理解了，开始练习
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuPanel({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`menu-panel absolute top-7 z-50 flex w-48 flex-col py-1 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function MenuButton({ label, onClick, shortcut }: { label: string; onClick: () => void; shortcut?: string }) {
  function runMenuAction(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onClick();
  }

  return (
    <button
      type="button"
      data-theme-id={label.includes("Claude") ? "theme-claude" : label.includes("动物") ? "theme-animal" : label.includes("液态") ? "theme-glass" : undefined}
      onClick={runMenuAction}
      className="menu-item"
    >
      <span>{label}</span>
      {shortcut ? <span className="text-[10px] opacity-55">{shortcut}</span> : null}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-b border-current/10" />;
}

type ReferenceTheme = "claude" | "animal-crossing" | "liquid-glass";

function getReferenceTheme(theme: ThemeId): ReferenceTheme {
  if (theme === "theme-animal") {
    return "animal-crossing";
  }
  if (theme === "theme-glass") {
    return "liquid-glass";
  }
  return "claude";
}

function getReferenceThemeClass(theme: ThemeId) {
  if (theme === "theme-animal") {
    return "assessor-theme-animal";
  }
  if (theme === "theme-glass") {
    return "assessor-theme-glass";
  }
  return "assessor-theme-claude";
}

function getTypographyClass(font: FontPreference, fontSize: FontSizePreference) {
  return `typography-font-${font} typography-size-${fontSize}`;
}

function getThemeLabel(theme: ThemeId) {
  if (theme === "theme-animal") {
    return "动物森友会";
  }
  if (theme === "theme-glass") {
    return "液态玻璃";
  }
  return "Claude";
}

function getAccentButtonClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:opacity-90";
  }
  if (theme === "animal-crossing") {
    return "rounded-xl border-b-4 border-[#358E61] bg-[#57C491] font-bold text-white hover:bg-[#45B27F]";
  }
  return "rounded-full bg-[#F27D26] font-semibold text-white transition hover:brightness-110";
}

function getSecondaryButtonClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "border border-white/10 bg-white/5 text-white hover:bg-white/10";
  }
  if (theme === "animal-crossing") {
    return "rounded-xl border-b-2 border-[#C6BBA3] bg-[#EFE8D3] font-semibold text-[#5C4D3C] hover:bg-[#E5DCC5]";
  }
  return "rounded-full border border-[#E8E8E6] bg-white text-[#5C5C5C] hover:bg-[#F7F7F5] hover:text-[#1D1D1F]";
}

function getCardClass(theme: ReferenceTheme) {
  if (theme === "liquid-glass") {
    return "rounded-xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-md";
  }
  if (theme === "animal-crossing") {
    return "rounded-2xl border-2 border-[#E9E4CE] bg-[#FCF9ED]";
  }
  return "rounded-xl border border-[#E8E8E6] bg-white shadow-xs";
}

function getScoreData(result: WorkspaceResult | null, activeTab: ResultTab) {
  if (!result) {
    return null;
  }
  if (activeTab === "fluency") {
    return result.fluencyScore;
  }
  if (activeTab === "lexical") {
    return result.lexicalScore;
  }
  if (activeTab === "grammar") {
    return result.grammarScore;
  }
  if (activeTab === "pronunciation") {
    return result.pronunciationScore;
  }
  return null;
}

function mapGradeResultToWorkspaceResult(result: GradeResult, transcriptText: string): WorkspaceResult {
  const transcript = splitTextIntoTranscript(transcriptText);
  return {
    overallScore: result.overall_band,
    fluencyScore: {
      score: result.sub_scores.FC,
      feedback: result.personal_style_comment,
      strengths: ["表达主线能够被理解", "回答内容可继续扩展为更完整段落"],
      improvements: ["增加自然连接词", "减少重复并补充具体例子"],
    },
    lexicalScore: {
      score: result.sub_scores.LR,
      feedback: result.vocabulary_corrections.length
        ? "模型识别到可替换的词汇与表达，建议优先整理为个人高频替换表。"
        : "当前词汇错误较少，但仍可继续升级搭配和地道表达。",
      strengths: ["核心意思表达清楚", "词汇基本符合题目语境"],
      improvements: result.vocabulary_corrections.map((correction) => `${correction.original} -> ${correction.suggested}`).slice(0, 3),
    },
    grammarScore: {
      score: result.sub_scores.GRA,
      feedback: "请结合句级修正复盘语法准确性，重点检查时态、单复数和从句结构。",
      strengths: ["基础句意完整", "有重构为复杂句的空间"],
      improvements: ["检查主谓一致", "将简单句合并为更自然的复合句"],
    },
    pronunciationScore: {
      score: result.sub_scores.PR,
      feedback: "当前文本批改无法直接评估真实发音；该分值来自模型对文本表现的结构化估计。",
      strengths: ["文本节奏可支持口头表达", "内容块适合按意群朗读"],
      improvements: ["接入音频评估后复盘重音和连读", "按 transcript 分句练习停顿"],
    },
    keyCorrections: result.vocabulary_corrections.map((correction) => ({
      original: correction.original,
      improved: correction.suggested,
      reason: correction.reason,
      category: "vocabulary",
    })),
    generalFeedback: result.personal_style_comment,
    modelAnswer: result.reconstructed_essay,
    transcript,
  };
}

function mapSpeechAssessmentToWorkspaceResult(result: SpeechAssessmentResult): WorkspaceResult {
  const transcriptText = getTranscriptText(result);
  const transcript = splitTextIntoTranscript(transcriptText);
  const transcriptTokens = buildTranscriptTokens(result.words);
  const pronunciationScore = normalizeAzureScoreToBand(result.overall.pronunciationScore);
  const fluencyScore = normalizeAzureScoreToBand(result.overall.fluencyScore);
  const accuracyScore = normalizeAzureScoreToBand(result.overall.accuracyScore);
  const completenessScore = normalizeAzureScoreToBand(result.overall.completenessScore);
  const lowAccuracyWords = result.words
    .filter((word) => word.accuracyScore !== undefined && word.accuracyScore < lowAccuracyThreshold)
    .slice(0, 8);

  return {
    overallScore: pronunciationScore,
    fluencyScore: {
      score: fluencyScore,
      feedback: `Azure 长音频评估已完成。Fluency 原始分：${formatOptionalScore(result.overall.fluencyScore)}。`,
      strengths: ["已基于真实音频生成逐词时间戳", "可结合播放器回听具体停顿和连读"],
      improvements: ["优先复盘红色停顿标注", "对低分词进行跟读和重录"],
    },
    lexicalScore: {
      score: completenessScore,
      feedback: `当前媒体链路聚焦发音与流利度；Completeness 原始分：${formatOptionalScore(result.overall.completenessScore)}。`,
      strengths: ["语音内容已被 Azure 识别为 transcript", "可将 transcript 复制到文本批改链路继续做词句升级"],
      improvements: ["如需词汇和语法细评，请使用手工文本模式提交 transcript", "补充题目上下文能帮助后续综合批改"],
    },
    grammarScore: {
      score: accuracyScore,
      feedback: "当前媒体链路不直接做语法诊断；这里使用 Accuracy 作为临时参考分，避免伪造语法结论。",
      strengths: ["发音准确度已有真实音频依据", "逐词评分可定位高风险词"],
      improvements: ["语法问题需进入文本批改链路", "复盘 transcript 中的长句和重复表达"],
    },
    pronunciationScore: {
      score: pronunciationScore,
      feedback: [
        `Pronunciation 原始分：${formatOptionalScore(result.overall.pronunciationScore)}。`,
        `Accuracy：${formatOptionalScore(result.overall.accuracyScore)}；Fluency：${formatOptionalScore(result.overall.fluencyScore)}；Prosody：${formatOptionalScore(result.overall.prosodyScore)}。`,
      ].join("\n"),
      strengths: ["已完成长音频 continuous assessment", "逐词评分、音素提示和时间戳可用于精听复盘"],
      improvements: lowAccuracyWords.length
        ? lowAccuracyWords.map((word) => `${word.word}: ${formatOptionalScore(word.accuracyScore)}`)
        : ["未发现明显低于 60 分的单词", "继续关注停顿和语调自然度"],
    },
    keyCorrections: lowAccuracyWords.map((word) => ({
      original: word.word,
      improved: word.word,
      reason: `Azure 逐词 Accuracy 为 ${formatOptionalScore(word.accuracyScore)}，建议点击 transcript 回听并跟读。`,
      category: "pronunciation",
    })),
    generalFeedback: "Azure 已基于转码后的 WAV 完成长音频发音评估。请在 transcript 中点击低分词或停顿标记附近回听，优先修正影响流利度和发音清晰度的问题。",
    modelAnswer: transcriptText || "Azure 未返回完整 transcript。",
    transcript,
    transcriptTokens,
    speechAssessment: result,
  };
}

function normalizeAzureScoreToBand(score: number | undefined) {
  if (score === undefined) {
    return 0;
  }

  return Number(Math.max(0, Math.min(9, (score / 100) * 9)).toFixed(1));
}

function formatOptionalScore(score: number | undefined) {
  return score === undefined ? "--" : score.toFixed(1);
}

function splitTextIntoTranscript(text: string): TranscriptChunk[] {
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks = sentences.length ? sentences : [text.trim()];
  return chunks.map((sentence, index) => ({
    timestamp: formatDuration(index * 7),
    seconds: index * 7,
    text: sentence,
  }));
}

function getLocalFilePath(file: File) {
  return (file as File & { path?: string }).path ?? "";
}

function getFileExtension(path: string) {
  const fileName = getFileNameFromPath(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension?.toLowerCase() ?? "";
}

function isSupportedMediaExtension(extension: string) {
  return ["mp4", "mp3", "m4a", "wav"].includes(extension);
}

function getFileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function isVideoPath(path: string) {
  return /\.(mp4|mov|m4v)$/i.test(path);
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getSubcategoryName(activeTab: ResultTab) {
  if (activeTab === "fluency") {
    return "Fluency & Coherence (流利度与连贯性)";
  }
  if (activeTab === "lexical") {
    return "Lexical Resource (词汇丰富度)";
  }
  if (activeTab === "grammar") {
    return "Grammatical Range (语法多样性与准确性)";
  }
  if (activeTab === "pronunciation") {
    return "Pronunciation (发音)";
  }
  return "";
}

function getScoreBadge(score: number) {
  if (score >= 7.5) {
    return "border border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
  }
  if (score >= 6) {
    return "border border-amber-500/20 bg-amber-500/10 text-amber-500";
  }
  return "border border-rose-500/20 bg-rose-500/10 text-rose-500";
}

function getCorrectionBadge(category: CorrectionCategory) {
  if (category === "grammar") {
    return "border-red-500/20 bg-red-400/10 text-red-500";
  }
  if (category === "vocabulary") {
    return "border-indigo-500/20 bg-indigo-400/10 text-indigo-500";
  }
  if (category === "coherence") {
    return "border-amber-500/20 bg-amber-400/10 text-amber-500";
  }
  return "border-cyan-500/20 bg-cyan-400/10 text-cyan-500";
}

function getCorrectionLabel(category: CorrectionCategory) {
  if (category === "grammar") {
    return "语法偏误";
  }
  if (category === "vocabulary") {
    return "词汇升级";
  }
  if (category === "coherence") {
    return "逻辑断流";
  }
  return "发音讹误";
}

function formatRecordDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = `${Math.floor(safeSeconds / 60)}`.padStart(2, "0");
  const seconds = `${safeSeconds % 60}`.padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function isTauriRuntimeAvailable() {
  return "__TAURI_INTERNALS__" in window;
}
