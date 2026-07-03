import { ArrowRight, Bookmark, CheckCircle2, ChevronDown, Clock, CornerDownRight, FileAudio, Pause, Play } from "lucide-react";
import type { PublicAppConfig } from "../../types/config";
import type {
  RagUsageInfo,
  ReferenceTheme,
  ResultTab,
  ScoreCriterion,
  SentenceCorrection,
  TranscriptChunk,
  WorkspaceResult as WorkspaceResultData,
} from "../../app/workspaceTypes";
import {
  formatDuration,
  getCorrectionBadge,
  getCorrectionLabel,
  getScoreBadge,
  getScoreData,
  getSubcategoryName,
} from "../../app/workspaceUtils";
import { TranscriptPanel } from "./TranscriptPanel";

type ResultTabOption = {
  id: ResultTab;
  name: string;
};

export function WorkspaceResult({
  config,
  currentTheme,
  cardClass,
  accentClass,
  displayedResult,
  displayedTranscript,
  displayedTitle,
  mediaPlayerUrl,
  currentTime,
  audioDuration,
  isPlaying,
  activeTab,
  resultSelectorOpen,
  resultSelectorDismissed,
  resultTabOptions,
  activeResultTabName,
  audioPlayerRef,
  wordTokenElementRefs,
  onOpenResultSelectorAfterDelay,
  onCloseResultSelector,
  onChooseResultTab,
  onTogglePlayback,
  onJumpToTimestamp,
  onChangePlaybackTime,
  onSetCurrentTime,
  onSetAudioDuration,
  onSetIsPlaying,
  onSetResultSelectorDismissed,
  onSetResultSelectorOpen,
}: {
  config: PublicAppConfig;
  currentTheme: ReferenceTheme;
  cardClass: string;
  accentClass: string;
  displayedResult: WorkspaceResultData | null;
  displayedTranscript: TranscriptChunk[];
  displayedTitle: string;
  mediaPlayerUrl: string | null;
  currentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  activeTab: ResultTab;
  resultSelectorOpen: boolean;
  resultSelectorDismissed: boolean;
  resultTabOptions: ResultTabOption[];
  activeResultTabName: string;
  audioPlayerRef: React.RefObject<HTMLAudioElement>;
  wordTokenElementRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  onOpenResultSelectorAfterDelay: () => void;
  onCloseResultSelector: () => void;
  onChooseResultTab: (nextResultTab: ResultTab) => void;
  onTogglePlayback: () => void;
  onJumpToTimestamp: (seconds: number) => void;
  onChangePlaybackTime: (seconds: number) => void;
  onSetCurrentTime: (currentTime: number) => void;
  onSetAudioDuration: (audioDuration: number) => void;
  onSetIsPlaying: (isPlaying: boolean) => void;
  onSetResultSelectorDismissed: (resultSelectorDismissed: boolean) => void;
  onSetResultSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const displayedTranscriptTokens = displayedResult?.transcriptTokens ?? [];
  const currentScoreData = getScoreData(displayedResult, activeTab);

  return (
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
            <AudioPlayer
              accentClass={accentClass}
              title="转码 WAV 播放器"
              description="当前播放的是 FFmpeg 输出的标准 WAV 文件。"
              mediaPlayerUrl={mediaPlayerUrl}
              currentTime={currentTime}
              audioDuration={audioDuration}
              isPlaying={isPlaying}
              audioPlayerRef={audioPlayerRef}
              onTogglePlayback={onTogglePlayback}
              onChangePlaybackTime={onChangePlaybackTime}
              onSetCurrentTime={onSetCurrentTime}
              onSetAudioDuration={onSetAudioDuration}
              onSetIsPlaying={onSetIsPlaying}
            />
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
                onMouseEnter={onOpenResultSelectorAfterDelay}
                onMouseLeave={onCloseResultSelector}
                onFocus={onOpenResultSelectorAfterDelay}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    onCloseResultSelector();
                  }
                }}
              >
                <button
                  type="button"
                  className={`result-selector-trigger result-tab-active-${currentTheme}`}
                  aria-haspopup="listbox"
                  aria-expanded={resultSelectorOpen}
                  onClick={() => {
                    onSetResultSelectorDismissed(false);
                    onSetResultSelectorOpen((current) => !current);
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
                      onClick={() => onChooseResultTab(tabOption.id)}
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

                {displayedResult.ragUsage ? (
                  <RagUsagePanel ragUsage={displayedResult.ragUsage} currentTheme={currentTheme} />
                ) : null}

                {displayedTranscriptTokens.length > 0 ? (
                  <div className="border-t border-current/10 pt-4">
                    <span className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider opacity-50">
                      <CheckCircle2 size={12} className={currentTheme === "claude" ? "text-[#F27D26]" : "text-emerald-500"} />
                      <span>逐词 transcript 与播放同步 (点击单词跳转)</span>
                    </span>
                    <TranscriptPanel
                      tokens={displayedTranscriptTokens}
                      wordTokenElementRefs={wordTokenElementRefs}
                      onJumpToTimestamp={onJumpToTimestamp}
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
                          onClick={() => onJumpToTimestamp(chunk.seconds)}
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
              <AudioPlayer
                accentClass={accentClass}
                title="口语练习音频播放器"
                description="播放转码后的 WAV 文件；Azure continuous mode 评估结果可点击词级 transcript 回听。"
                mediaPlayerUrl={mediaPlayerUrl}
                currentTime={currentTime}
                audioDuration={audioDuration}
                isPlaying={isPlaying}
                audioPlayerRef={audioPlayerRef}
                onTogglePlayback={onTogglePlayback}
                onChangePlaybackTime={onChangePlaybackTime}
                onSetCurrentTime={onSetCurrentTime}
                onSetAudioDuration={onSetAudioDuration}
                onSetIsPlaying={onSetIsPlaying}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AudioPlayer({
  accentClass,
  title,
  description,
  mediaPlayerUrl,
  currentTime,
  audioDuration,
  isPlaying,
  audioPlayerRef,
  onTogglePlayback,
  onChangePlaybackTime,
  onSetCurrentTime,
  onSetAudioDuration,
  onSetIsPlaying,
}: {
  accentClass: string;
  title: string;
  description: string;
  mediaPlayerUrl: string;
  currentTime: number;
  audioDuration: number;
  isPlaying: boolean;
  audioPlayerRef: React.RefObject<HTMLAudioElement>;
  onTogglePlayback: () => void;
  onChangePlaybackTime: (seconds: number) => void;
  onSetCurrentTime: (currentTime: number) => void;
  onSetAudioDuration: (audioDuration: number) => void;
  onSetIsPlaying: (isPlaying: boolean) => void;
}) {
  return (
    <div className="w-full max-w-xl rounded-xl border border-current/10 bg-current/[0.02] p-3 text-left">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onTogglePlayback}
            className={`shrink-0 rounded-full p-2.5 text-white ${accentClass}`}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
          </button>
          <div className="leading-tight">
            <p className="max-w-[260px] truncate text-[11px] font-bold">{title}</p>
            <p className="text-[10px] opacity-50">{description}</p>
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
            onChange={(event) => onChangePlaybackTime(Number(event.target.value))}
            className="w-full accent-current"
          />
          <span className="font-mono text-[10px] tabular-nums opacity-50">
            {formatDuration(audioDuration || 60)}
          </span>
        </div>
        <audio
          ref={audioPlayerRef}
          src={mediaPlayerUrl}
          onTimeUpdate={() => onSetCurrentTime(audioPlayerRef.current?.currentTime ?? 0)}
          onLoadedMetadata={() => onSetAudioDuration(audioPlayerRef.current?.duration ?? 0)}
          onEnded={() => onSetIsPlaying(false)}
        >
          <track kind="captions" />
        </audio>
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

function RagUsagePanel({ ragUsage, currentTheme }: { ragUsage: RagUsageInfo; currentTheme: ReferenceTheme }) {
  const statusClass =
    ragUsage.status === "matched"
      ? "border-emerald-500/15 bg-emerald-500/5 text-emerald-700"
      : ragUsage.status === "failed"
        ? "border-amber-500/20 bg-amber-500/5 text-amber-700"
        : "border-current/10 bg-current/[0.02]";

  return (
    <div className={`rounded-lg border p-3 ${statusClass}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
          <Bookmark size={12} className={currentTheme === "claude" ? "text-[#F27D26]" : undefined} />
          <span>教师案例引用</span>
        </span>
        {ragUsage.references.length ? (
          <span className="rounded bg-current/10 px-2 py-0.5 font-mono text-[10px] font-bold">
            Top {ragUsage.references.length}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed opacity-80">{ragUsage.message}</p>
      {ragUsage.references.length ? (
        <div className="mt-2 grid gap-2">
          {ragUsage.references.map((reference) => (
            <div key={reference.caseId} className="rounded-md border border-current/10 bg-white/40 p-2 text-[11px] leading-relaxed">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{reference.originalText}</span>
                <span className="shrink-0 font-mono text-[10px] opacity-70">
                  {formatSimilarity(reference.score)}
                </span>
              </div>
              <p className="line-clamp-2 opacity-75">{reference.teacherComment}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatSimilarity(score: number) {
  if (!Number.isFinite(score)) {
    return "--";
  }
  return score.toFixed(2);
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
