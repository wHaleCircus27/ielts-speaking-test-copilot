import type {
  SpeechAssessmentResult,
  SpeechWordAssessment,
  TranscriptToken,
} from "../types/speech";

export const severePauseThresholdMs = 2000;
export const lowAccuracyThreshold = 60;

export function buildTranscriptTokens(
  words: SpeechWordAssessment[],
): TranscriptToken[] {
  const sortedWords = [...words].sort(
    (leftWord, rightWord) => leftWord.startMs - rightWord.startMs,
  );
  const tokens: TranscriptToken[] = [];

  sortedWords.forEach((word, index) => {
    if (index > 0) {
      const previousWord = sortedWords[index - 1];
      const pauseDurationMs =
        word.startMs - (previousWord.startMs + previousWord.durationMs);
      if (pauseDurationMs >= severePauseThresholdMs) {
        tokens.push({
          type: "pause",
          id: `pause-${index}-${pauseDurationMs}`,
          durationMs: pauseDurationMs,
          severe: true,
        });
      }
    }

    tokens.push({
      type: "word",
      id: `word-${index}-${word.startMs}-${word.word}`,
      text: word.word,
      startMs: word.startMs,
      endMs: word.startMs + word.durationMs,
      accuracyScore: word.accuracyScore,
      phonemeErrors: (word.phonemes ?? [])
        .filter(
          (phoneme) =>
            phoneme.accuracyScore !== undefined &&
            phoneme.accuracyScore < lowAccuracyThreshold,
        )
        .map(
          (phoneme) =>
            `${phoneme.phoneme}: ${Math.round(phoneme.accuracyScore ?? 0)}`,
        ),
    });
  });

  return tokens;
}

export function findCurrentWordToken(
  tokens: TranscriptToken[],
  currentTimeSeconds: number,
) {
  const currentTimeMs = currentTimeSeconds * 1000;
  return tokens.find(
    (token) =>
      token.type === "word" &&
      currentTimeMs >= token.startMs &&
      currentTimeMs <= token.endMs,
  );
}

export function getTranscriptText(result: SpeechAssessmentResult) {
  if (result.recognizedText.trim()) {
    return result.recognizedText.trim();
  }

  return result.words
    .map((word) => word.word)
    .join(" ")
    .trim();
}
