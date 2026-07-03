export type SpeakingPart = "part1" | "part2" | "part3";

export type RagPromptExample = {
  originalText: string;
  revisedText: string;
  teacherComment: string;
  scoringPreference?: string;
  score?: number;
};

export type GradeRequest = {
  text: string;
  part: SpeakingPart;
  question?: string;
  ragExamples?: RagPromptExample[];
};

export type GradeResult = {
  overall_band: number;
  sub_scores: {
    FC: number;
    LR: number;
    GRA: number;
    PR: number;
  };
  personal_style_comment: string;
  vocabulary_corrections: Array<{
    original: string;
    suggested: string;
    reason: string;
  }>;
  reconstructed_essay: string;
};

export type ConfigValidationResult = {
  ok: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  serviceReachable: boolean;
  availableModels: string[];
  message: string;
};
