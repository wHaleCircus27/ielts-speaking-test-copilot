import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { PublicAppConfig } from "../../types/config";
import type { SpeakingPart } from "../../types/grading";
import type { CorrectionRecord, ResultTab, WorkspaceResult as WorkspaceResultData } from "../../app/workspaceTypes";
import { getAccentButtonClass, getCardClass, getFileNameFromPath, getSecondaryButtonClass } from "../../app/workspaceUtils";
import { useMediaWorkflow } from "../../hooks/useMediaWorkflow";
import { useTranscriptPlayback } from "../../hooks/useTranscriptPlayback";
import { WorkspaceInput } from "./WorkspaceInput";
import { WorkspaceResult } from "./WorkspaceResult";

export function Workspace({
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
  currentTheme: "claude" | "animal-crossing" | "liquid-glass";
  isLoading: boolean;
  pendingMediaPath: string;
  serviceReady: boolean;
  onClearPendingMedia: () => void;
  onAddRecord: (title: string, fileName: string, result: WorkspaceResultData) => void;
  onSubmitText: (input: {
    answer: string;
    part: SpeakingPart;
    question: string;
    title: string;
    fileName: string;
  }) => Promise<void>;
}) {
  const [customTitle, setCustomTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [part, setPart] = useState<SpeakingPart>("part2");
  const [textInput, setTextInput] = useState("");
  const [activeTab, setActiveTab] = useState<ResultTab>("overall");
  const [resultSelectorOpen, setResultSelectorOpen] = useState(false);
  const [resultSelectorDismissed, setResultSelectorDismissed] = useState(false);
  const browserFileInputRef = useRef<HTMLInputElement | null>(null);
  const resultSelectorHoverTimerRef = useRef<number | null>(null);

  const displayedResult = activeRecord?.result ?? null;
  const displayedTranscript = displayedResult?.transcript ?? activeRecord?.transcript ?? [];
  const displayedTranscriptTokens = displayedResult?.transcriptTokens ?? [];
  const displayedTitle = activeRecord?.title ?? "雅思口语作业批改";
  const transcriptPlayback = useTranscriptPlayback(displayedTranscriptTokens);

  const mediaWorkflow = useMediaWorkflow({
    config,
    serviceReady,
    pendingMediaPath,
    question,
    part,
    customTitle,
    onAddRecord,
    onClearPendingMedia,
    resetPlaybackState: transcriptPlayback.resetPlaybackState,
  });

  useEffect(() => {
    if (activeRecord) {
      setActiveTab("overall");
      setResultSelectorOpen(false);
      setResultSelectorDismissed(false);
      transcriptPlayback.resetPlaybackState();
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
  const answerLength = textInput.trim().length;
  const canSubmitText = serviceReady && config.deepseek.apiKeyConfigured && answerLength >= 20 && !isLoading;
  const mediaPlayerUrl = useMemo(
    () => (mediaWorkflow.mediaTranscodeResult ? convertFileSrc(mediaWorkflow.mediaTranscodeResult.outputPath) : null),
    [mediaWorkflow.mediaTranscodeResult],
  );
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

  async function submitCorrection() {
    const title =
      customTitle.trim() ||
      question.trim() ||
      (mediaWorkflow.mediaMetadata?.fileName ?? getFileNameFromPath(mediaWorkflow.mediaPath)).replace(/\.[^/.]+$/, "") ||
      "IELTS 口语练习";

    if (mediaWorkflow.inputMode === "media") {
      await mediaWorkflow.startMediaAiCorrection();
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

  return (
    <div className="flex min-h-full w-full flex-col space-y-4 min-[1180px]:h-full">
      <div className="grid grid-cols-1 gap-5 min-[1180px]:min-h-0 min-[1180px]:flex-1 min-[1180px]:grid-cols-12">
        <WorkspaceInput
          config={config}
          inputMode={mediaWorkflow.inputMode}
          customTitle={customTitle}
          question={question}
          part={part}
          textInput={textInput}
          mediaPath={mediaWorkflow.mediaPath}
          mediaMetadata={mediaWorkflow.mediaMetadata}
          mediaTranscodeResult={mediaWorkflow.mediaTranscodeResult}
          speechAssessmentResult={mediaWorkflow.speechAssessmentResult}
          mediaBusy={mediaWorkflow.mediaBusy}
          mediaPreviewOnly={mediaWorkflow.mediaPreviewOnly}
          mediaNotice={mediaWorkflow.mediaNotice}
          mediaError={mediaWorkflow.mediaError}
          dragging={mediaWorkflow.dragging}
          answerLength={answerLength}
          canSubmitText={canSubmitText}
          canStartMediaCorrection={mediaWorkflow.canStartMediaCorrection}
          isLoading={isLoading}
          serviceReady={serviceReady}
          cardClass={cardClass}
          accentClass={accentClass}
          secondaryClass={secondaryClass}
          browserFileInputRef={browserFileInputRef}
          onSetInputMode={mediaWorkflow.setInputMode}
          onSetCustomTitle={setCustomTitle}
          onSetQuestion={setQuestion}
          onSetPart={setPart}
          onSetTextInput={setTextInput}
          onSetDragging={mediaWorkflow.setDragging}
          onChooseMediaFile={() => void mediaWorkflow.chooseMediaFileFromDialog(browserFileInputRef.current)}
          onHandleDroppedFile={mediaWorkflow.handleDroppedFile}
          onLoadBrowserPreviewFile={mediaWorkflow.loadBrowserPreviewFile}
          onClearSelectedMedia={mediaWorkflow.clearSelectedMedia}
          onSubmitCorrection={() => void submitCorrection()}
        />

        <WorkspaceResult
          config={config}
          currentTheme={currentTheme}
          cardClass={cardClass}
          accentClass={accentClass}
          displayedResult={displayedResult}
          displayedTranscript={displayedTranscript}
          displayedTitle={displayedTitle}
          mediaPlayerUrl={mediaPlayerUrl}
          currentTime={transcriptPlayback.currentTime}
          audioDuration={transcriptPlayback.audioDuration}
          isPlaying={transcriptPlayback.isPlaying}
          activeTab={activeTab}
          resultSelectorOpen={resultSelectorOpen}
          resultSelectorDismissed={resultSelectorDismissed}
          resultTabOptions={resultTabOptions}
          activeResultTabName={activeResultTabName}
          audioPlayerRef={transcriptPlayback.audioPlayerRef}
          wordTokenElementRefs={transcriptPlayback.wordTokenElementRefs}
          onOpenResultSelectorAfterDelay={openResultSelectorAfterDelay}
          onCloseResultSelector={closeResultSelector}
          onChooseResultTab={chooseResultTab}
          onTogglePlayback={transcriptPlayback.togglePlayback}
          onJumpToTimestamp={transcriptPlayback.jumpToTimestamp}
          onChangePlaybackTime={transcriptPlayback.changePlaybackTime}
          onSetCurrentTime={transcriptPlayback.setCurrentTime}
          onSetAudioDuration={transcriptPlayback.setAudioDuration}
          onSetIsPlaying={transcriptPlayback.setIsPlaying}
          onSetResultSelectorDismissed={setResultSelectorDismissed}
          onSetResultSelectorOpen={setResultSelectorOpen}
        />
      </div>
    </div>
  );
}
