import { invokeCommand } from "./tauri";
import type { MediaImportRequest, MediaMetadata, MediaTranscodeResult } from "../types/media";

export function selectMediaFile() {
  return invokeCommand<string | null>("select_media_file");
}

export function transcodeMedia(request: MediaImportRequest) {
  return invokeCommand<MediaTranscodeResult>("transcode_media", { request });
}

export function getMediaMetadata(path: string) {
  return invokeCommand<MediaMetadata>("get_media_metadata", { path });
}
