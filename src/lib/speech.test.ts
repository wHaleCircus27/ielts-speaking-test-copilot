import { describe, expect, it } from "vitest";
import { mapAzureSpeechResultJson } from "./speech";

describe("Azure speech result mapping", () => {
  it("maps Microsoft-style detailed Azure JSON into the app speech assessment shape", () => {
    const result = mapAzureSpeechResultJson(
      JSON.stringify({
        Id: "mock-result-from-microsoft-doc-shape",
        RecognitionStatus: 0,
        Offset: 7_500_000,
        Duration: 53_000_000,
        DisplayText: "Hello world today.",
        NBest: [
          {
            Confidence: 0.975003,
            Lexical: "hello world today",
            ITN: "hello world today",
            MaskedITN: "hello world today",
            Display: "Hello world today.",
            PronunciationAssessment: {
              AccuracyScore: 91,
              FluencyScore: 88,
              CompletenessScore: 96,
              ProsodyScore: 82,
              PronScore: 89,
            },
            Words: [
              {
                Word: "Hello",
                Offset: 0,
                Duration: 5_000_000,
                PronunciationAssessment: {
                  AccuracyScore: 92,
                  ErrorType: "None",
                },
                Phonemes: [
                  {
                    Phoneme: "h",
                    PronunciationAssessment: {
                      AccuracyScore: 90,
                    },
                  },
                ],
              },
              {
                Word: "world",
                Offset: 20_000_000,
                Duration: 5_000_000,
                PronunciationAssessment: {
                  AccuracyScore: 58,
                  ErrorType: "Mispronunciation",
                },
                Phonemes: [
                  {
                    Phoneme: "er",
                    PronunciationAssessment: {
                      AccuracyScore: 41,
                    },
                  },
                ],
              },
              {
                Word: "today",
                Offset: 48_000_000,
                Duration: 5_000_000,
                PronunciationAssessment: {
                  AccuracyScore: 74,
                  ErrorType: "UnexpectedBreak",
                },
              },
            ],
          },
        ],
      }),
    );

    expect(result.recognizedText).toBe("Hello world today.");
    expect(result.durationMs).toBe(5300);
    expect(result.overall.pronunciationScore).toBe(89);
    expect(result.words).toEqual([
      expect.objectContaining({
        word: "Hello",
        startMs: 0,
        durationMs: 500,
        accuracyScore: 92,
        errorType: "None",
      }),
      expect.objectContaining({
        word: "world",
        startMs: 2000,
        durationMs: 500,
        accuracyScore: 58,
        errorType: "Mispronunciation",
        phonemes: [expect.objectContaining({ phoneme: "er", accuracyScore: 41 })],
      }),
      expect.objectContaining({
        word: "today",
        startMs: 4800,
        durationMs: 500,
        accuracyScore: 74,
        errorType: "UnexpectedBreak",
      }),
    ]);
  });

  it("returns an empty result when Azure detailed JSON has no usable words or transcript", () => {
    const result = mapAzureSpeechResultJson(
      JSON.stringify({
        Duration: 0,
        NBest: [
          {
            PronunciationAssessment: {
              AccuracyScore: 0,
              FluencyScore: 0,
              PronScore: 0,
            },
            Words: [],
          },
        ],
      }),
    );

    expect(result.recognizedText).toBe("");
    expect(result.durationMs).toBe(0);
    expect(result.words).toEqual([]);
  });

  it("throws a normalized app error for invalid Azure JSON", () => {
    expect(() => mapAzureSpeechResultJson("not-json")).toThrow("Azure 语音评估响应无法解析。");
  });
});
