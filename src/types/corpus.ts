export type TeacherCaseInput = {
  originalText: string;
  revisedText: string;
  teacherComment: string;
  scoringPreference?: string;
};

export type EmbeddingStatus = "pending" | "ready" | "failed";

export type TeacherCase = TeacherCaseInput & {
  id: string;
  embeddingStatus: EmbeddingStatus;
  embeddingError?: string;
  createdAt: string;
  updatedAt: string;
};

export type TeacherCaseMatch = {
  case: TeacherCase;
  score: number;
};

export type QueryEmbeddingSource = "cache" | "network";

export type TeacherCaseDiagnosticMatch = {
  case: TeacherCase;
  score: number;
};

export type TeacherCaseSearchDiagnostics = {
  threshold: number;
  topK: number;
  readyCandidateCount: number;
  matchedCount: number;
  belowThresholdCount: number;
  embeddingSource: QueryEmbeddingSource;
  durationMs: number;
  included: TeacherCaseDiagnosticMatch[];
  nearMisses: TeacherCaseDiagnosticMatch[];
};
