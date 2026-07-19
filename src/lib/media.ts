import { invokeCommand } from "./tauri";
import type {
  CancelMediaTranscodeResult,
  GeneratedMediaReconcileResult,
  MediaImportRequest,
  MediaMetadata,
  MediaTranscodeResult,
} from "../types/media";

export function selectMediaFile() {
  return invokeCommand<string | null>("select_media_file");
}

export function transcodeMedia(request: MediaImportRequest) {
  return invokeCommand<MediaTranscodeResult>("transcode_media", { request });
}

export function getMediaMetadata(path: string) {
  return invokeCommand<MediaMetadata>("get_media_metadata", { path });
}

export function cancelMediaTranscode(jobId: string) {
  return invokeCommand<CancelMediaTranscodeResult>("cancel_media_transcode", {
    jobId,
  });
}

export function deleteGeneratedMediaFile(path: string) {
  return invokeCommand<boolean>("delete_generated_media_file", { path });
}

export function reconcileGeneratedMedia(referencedPaths: string[]) {
  return invokeCommand<GeneratedMediaReconcileResult>(
    "reconcile_generated_media",
    {
      referencedPaths,
    },
  );
}
