export type SpeechAssessRequest = {
  wavPath: string;
  durationMs: number;
  referenceText?: string;
};

export type SpeechAssessmentOverall = {
  accuracyScore?: number;
  fluencyScore?: number;
  completenessScore?: number;
  prosodyScore?: number;
  pronunciationScore?: number;
};

export type SpeechWordAssessment = {
  word: string;
  startMs: number;
  durationMs: number;
  accuracyScore?: number;
  errorType?: string;
  phonemes?: Array<{
    phoneme: string;
    accuracyScore?: number;
  }>;
};

export type SpeechAssessmentResult = {
  overall: SpeechAssessmentOverall;
  words: SpeechWordAssessment[];
  durationMs: number;
  recognizedText: string;
};

export type AzureConfigValidationResult = {
  ok: boolean;
  keyConfigured: boolean;
  region: string;
  language: string;
  message: string;
};

export type AzureSpeechToken = {
  token: string;
  region: string;
  language: string;
};

export type TranscriptToken =
  | {
      type: "word";
      id: string;
      text: string;
      startMs: number;
      endMs: number;
      accuracyScore?: number;
      phonemeErrors?: string[];
    }
  | {
      type: "pause";
      id: string;
      durationMs: number;
      severe: boolean;
    };
