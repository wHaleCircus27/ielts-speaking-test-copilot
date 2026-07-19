import { describe, expect, it } from "vitest";
import {
  buildTranscriptTokens,
  findCurrentWordToken,
  lowAccuracyThreshold,
  severePauseThresholdMs,
} from "./transcript";

describe("transcript tokens", () => {
  it("inserts severe pause tokens between distant words", () => {
    const tokens = buildTranscriptTokens([
      { word: "hello", startMs: 0, durationMs: 500, accuracyScore: 90 },
      {
        word: "world",
        startMs: severePauseThresholdMs + 700,
        durationMs: 400,
        accuracyScore: 88,
      },
    ]);

    expect(tokens).toEqual([
      expect.objectContaining({ type: "word", text: "hello" }),
      expect.objectContaining({
        type: "pause",
        durationMs: severePauseThresholdMs + 200,
        severe: true,
      }),
      expect.objectContaining({ type: "word", text: "world" }),
    ]);
  });

  it("marks low accuracy phonemes for hover display", () => {
    const [token] = buildTranscriptTokens([
      {
        word: "pronunciation",
        startMs: 100,
        durationMs: 900,
        accuracyScore: lowAccuracyThreshold - 1,
        phonemes: [
          { phoneme: "p", accuracyScore: 72 },
          { phoneme: "r", accuracyScore: 42 },
        ],
      },
    ]);

    expect(token).toEqual(
      expect.objectContaining({
        type: "word",
        text: "pronunciation",
        accuracyScore: 59,
        phonemeErrors: ["r: 42"],
      }),
    );
  });

  it("sorts Azure words before generating pauses and word tokens", () => {
    const tokens = buildTranscriptTokens([
      { word: "third", startMs: 4200, durationMs: 400, accuracyScore: 74 },
      { word: "first", startMs: 0, durationMs: 400, accuracyScore: 93 },
      { word: "second", startMs: 700, durationMs: 400, accuracyScore: 55 },
    ]);

    expect(tokens).toEqual([
      expect.objectContaining({ type: "word", text: "first" }),
      expect.objectContaining({ type: "word", text: "second" }),
      expect.objectContaining({
        type: "pause",
        durationMs: 3100,
        severe: true,
      }),
      expect.objectContaining({ type: "word", text: "third" }),
    ]);
  });

  it("finds the currently playing word token", () => {
    const tokens = buildTranscriptTokens([
      { word: "first", startMs: 0, durationMs: 500 },
      { word: "second", startMs: 600, durationMs: 500 },
    ]);

    const currentToken = findCurrentWordToken(tokens, 0.75);

    expect(currentToken).toEqual(
      expect.objectContaining({ type: "word", text: "second" }),
    );
  });
});
