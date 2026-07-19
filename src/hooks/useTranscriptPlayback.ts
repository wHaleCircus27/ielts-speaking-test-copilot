import { useCallback, useEffect, useRef, useState } from "react";
import { findCurrentWordToken } from "../lib/transcript";
import type { TranscriptToken } from "../types/speech";

export function useTranscriptPlayback(
  displayedTranscriptTokens: TranscriptToken[],
) {
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const activeWordTokenIdRef = useRef<string | null>(null);
  const wordTokenElementRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
  const currentWordToken = findCurrentWordToken(
    displayedTranscriptTokens,
    currentTime,
  );

  useEffect(() => {
    const previousActiveWordTokenId = activeWordTokenIdRef.current;
    if (previousActiveWordTokenId) {
      wordTokenElementRefs.current[previousActiveWordTokenId]?.classList.remove(
        "transcript-word-active",
      );
    }

    if (currentWordToken?.type === "word") {
      wordTokenElementRefs.current[currentWordToken.id]?.classList.add(
        "transcript-word-active",
      );
      activeWordTokenIdRef.current = currentWordToken.id;
    } else {
      activeWordTokenIdRef.current = null;
    }
  }, [currentWordToken?.id, currentWordToken?.type]);

  const resetPlaybackState = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
  }, []);

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

  function changePlaybackTime(seconds: number) {
    setCurrentTime(seconds);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = seconds;
    }
  }

  return {
    currentTime,
    audioDuration,
    isPlaying,
    audioPlayerRef,
    wordTokenElementRefs,
    setCurrentTime,
    setAudioDuration,
    setIsPlaying,
    resetPlaybackState,
    togglePlayback,
    jumpToTimestamp,
    changePlaybackTime,
  };
}
