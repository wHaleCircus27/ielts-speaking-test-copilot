import type { SpeechAssessmentResult, TranscriptToken } from "../types/speech";

export type MenuId = "app" | "file" | "themes";
export type InputMode = "media" | "text";
export type ResultTab = "overall" | "fluency" | "lexical" | "grammar" | "pronunciation" | "corrections";
export type CorrectionCategory = "grammar" | "vocabulary" | "pronunciation" | "coherence";
export type ReferenceTheme = "claude" | "animal-crossing" | "liquid-glass";

export type TranscriptChunk = {
  timestamp: string;
  text: string;
  seconds: number;
};

export type ScoreCriterion = {
  score: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
};

export type SentenceCorrection = {
  original: string;
  improved: string;
  reason: string;
  category: CorrectionCategory;
};

export type WorkspaceResult = {
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

export type CorrectionRecord = {
  id: string;
  title: string;
  date: string;
  fileName: string;
  duration: string;
  transcript: TranscriptChunk[];
  result: WorkspaceResult;
};
