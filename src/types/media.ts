export type MediaImportRequest = {
  jobId: string;
  inputPath: string;
};

export type MediaTranscodeResult = {
  inputPath: string;
  outputPath: string;
  format: "wav";
  sampleRate: 16000;
  channels: 1;
  codec: "pcm_s16le";
  durationMs: number;
  logSummary?: string;
};

export type MediaMetadata = {
  path: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  supported: boolean;
  durationMs?: number;
};

export type MediaProcessingPhase =
  "idle" | "inspecting" | "transcoding" | "assessing" | "grading" | "canceling";

export type CancelMediaTranscodeResult = {
  jobId: string;
  canceled: boolean;
};

export type GeneratedMediaReconcileResult = {
  removedFiles: number;
  removedBytes: number;
  totalBytes: number;
  capacityBytes: number;
};
