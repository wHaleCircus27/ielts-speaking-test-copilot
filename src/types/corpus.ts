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
  createdAt: string;
  updatedAt: string;
};

export type TeacherCaseMatch = {
  case: TeacherCase;
  score: number;
};
