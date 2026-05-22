use crate::AppError;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const SUPPORTED_EXTENSIONS: &[&str] = &["mp4", "mp3", "m4a", "wav"];

#[derive(Debug, Clone)]
enum MediaConverter {
    Ffmpeg(PathBuf),
    #[cfg(target_os = "macos")]
    Afconvert(PathBuf),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaImportRequest {
    input_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaTranscodeResult {
    input_path: String,
    output_path: String,
    format: &'static str,
    sample_rate: u32,
    channels: u8,
    codec: &'static str,
    duration_ms: Option<u64>,
    log_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaMetadata {
    path: String,
    file_name: String,
    extension: String,
    size_bytes: u64,
    supported: bool,
}

#[tauri::command]
pub(crate) fn select_media_file() -> Result<Option<String>, AppError> {
    let file = rfd::FileDialog::new()
        .add_filter("Media", &["mp4", "mp3", "m4a", "wav"])
        .pick_file();

    Ok(file.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) fn get_media_metadata(path: String) -> Result<MediaMetadata, AppError> {
    read_media_metadata(Path::new(&path))
}

#[tauri::command]
pub(crate) async fn transcode_media(
    app: AppHandle,
    request: MediaImportRequest,
) -> Result<MediaTranscodeResult, AppError> {
    transcode_media_impl(&app, request)
}

fn transcode_media_impl(
    app: &AppHandle,
    request: MediaImportRequest,
) -> Result<MediaTranscodeResult, AppError> {
    let input = PathBuf::from(request.input_path.trim());
    let metadata = read_media_metadata(&input)?;
    if !metadata.supported {
        return Err(AppError::new(
            "MEDIA_UNSUPPORTED_TYPE",
            "仅支持 MP4、MP3、M4A 和 WAV 文件。",
        ));
    }

    if metadata.size_bytes == 0 {
        return Err(AppError::new("MEDIA_EMPTY_FILE", "媒体文件为空。"));
    }

    let output_dir = app.path().app_cache_dir().map_err(|error| {
        AppError::with_detail(
            "MEDIA_CACHE_PATH_FAILED",
            "无法定位媒体缓存目录。",
            error.to_string(),
        )
    })?;
    fs::create_dir_all(&output_dir).map_err(|error| {
        AppError::with_detail(
            "MEDIA_CACHE_CREATE_FAILED",
            "创建媒体缓存目录失败。",
            error.to_string(),
        )
    })?;

    let output_path = output_dir.join(output_file_name(&input));
    let converter = resolve_media_converter()?;
    let output = run_media_converter(&converter, &input, &output_path)?;

    if !output.status.success() {
        return Err(AppError::with_detail(
            "MEDIA_TRANSCODE_FAILED",
            "媒体转码失败。",
            summarize_process_output(&output),
        ));
    }

    Ok(MediaTranscodeResult {
        input_path: input.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        format: "wav",
        sample_rate: 16000,
        channels: 1,
        codec: "pcm_s16le",
        duration_ms: None,
        log_summary: Some(converter_log_summary(&converter, &output)),
    })
}

fn read_media_metadata(path: &Path) -> Result<MediaMetadata, AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::new("MEDIA_PATH_EMPTY", "媒体文件路径不能为空。"));
    }

    let raw_metadata = fs::metadata(path).map_err(|error| {
        AppError::with_detail(
            "MEDIA_FILE_NOT_FOUND",
            "无法读取媒体文件。",
            error.to_string(),
        )
    })?;

    if !raw_metadata.is_file() {
        return Err(AppError::new("MEDIA_NOT_FILE", "请选择一个媒体文件。"));
    }

    let extension = normalized_extension(path);
    Ok(MediaMetadata {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "media".to_string()),
        supported: is_supported_extension(&extension),
        extension,
        size_bytes: raw_metadata.len(),
    })
}

fn normalized_extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_supported_extension(extension: &str) -> bool {
    SUPPORTED_EXTENSIONS.contains(&extension)
}

fn output_file_name(input: &Path) -> String {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "media".into());
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);

    format!("{stem}-{millis}.wav")
}

fn ffmpeg_args(input: &Path, output: &Path) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string_lossy().to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        output.to_string_lossy().to_string(),
    ]
}

#[cfg(target_os = "macos")]
fn afconvert_args(input: &Path, output: &Path) -> Vec<String> {
    vec![
        "-f".to_string(),
        "WAVE".to_string(),
        "-d".to_string(),
        "LEI16@16000".to_string(),
        "-c".to_string(),
        "1".to_string(),
        input.to_string_lossy().to_string(),
        output.to_string_lossy().to_string(),
    ]
}

fn resolve_media_converter() -> Result<MediaConverter, AppError> {
    if let Some(ffmpeg_path) = resolve_ffmpeg_path() {
        return Ok(MediaConverter::Ffmpeg(ffmpeg_path));
    }

    #[cfg(target_os = "macos")]
    {
        if command_can_start("afconvert") {
            return Ok(MediaConverter::Afconvert(PathBuf::from("afconvert")));
        }
    }

    Err(AppError::new(
        "MEDIA_CONVERTER_MISSING",
        "无法启动媒体转码器，请安装 FFmpeg、配置 FFMPEG_PATH，或在 macOS 上确认 afconvert 可用。",
    ))
}

fn resolve_ffmpeg_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("FFMPEG_PATH") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    for candidate in [
        PathBuf::from("src-tauri/binaries/ffmpeg"),
        PathBuf::from("src-tauri/binaries/ffmpeg-aarch64-apple-darwin"),
        PathBuf::from("./binaries/ffmpeg"),
        PathBuf::from("./binaries/ffmpeg-aarch64-apple-darwin"),
    ] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if command_can_start("ffmpeg") {
        return Some(PathBuf::from("ffmpeg"));
    }

    None
}

fn command_can_start(command: &str) -> bool {
    Command::new(command).arg("-h").output().is_ok()
}

fn run_media_converter(
    converter: &MediaConverter,
    input: &Path,
    output: &Path,
) -> Result<Output, AppError> {
    match converter {
        MediaConverter::Ffmpeg(ffmpeg_path) => Command::new(ffmpeg_path)
            .args(ffmpeg_args(input, output))
            .output()
            .map_err(|error| {
                AppError::with_detail(
                    "FFMPEG_START_FAILED",
                    "无法启动 FFmpeg，请确认已安装或已配置 sidecar。",
                    error.to_string(),
                )
            }),
        #[cfg(target_os = "macos")]
        MediaConverter::Afconvert(afconvert_path) => Command::new(afconvert_path)
            .args(afconvert_args(input, output))
            .output()
            .map_err(|error| {
                AppError::with_detail(
                    "AFCONVERT_START_FAILED",
                    "无法启动 macOS afconvert 转码器。",
                    error.to_string(),
                )
            }),
    }
}

fn converter_log_summary(converter: &MediaConverter, output: &Output) -> String {
    let process_summary = summarize_process_output(output);
    let converter_name = match converter {
        MediaConverter::Ffmpeg(_) => "FFmpeg",
        #[cfg(target_os = "macos")]
        MediaConverter::Afconvert(_) => "afconvert",
    };

    if process_summary.is_empty() {
        format!("{converter_name} 转码完成。")
    } else {
        format!("{converter_name} 转码完成。\n{process_summary}")
    }
}

fn summarize_process_output(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    raw.lines()
        .rev()
        .filter(|line| !line.trim().is_empty())
        .map(sanitize_process_log_line)
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn sanitize_process_log_line(line: &str) -> String {
    if contains_local_path_like_text(line) {
        "[已隐藏包含本地路径的转码日志行]".to_string()
    } else {
        line.to_string()
    }
}

fn contains_local_path_like_text(line: &str) -> bool {
    if line.contains("file:") {
        return true;
    }

    line.split_whitespace().any(|token| {
        let trimmed_token = token.trim_matches(|value: char| {
            value == '\''
                || value == '"'
                || value == '`'
                || value == '('
                || value == ')'
                || value == '['
                || value == ']'
                || value == ','
                || value == ':'
        });

        trimmed_token.starts_with('/')
            || trimmed_token.starts_with("~/")
            || has_windows_drive_prefix(trimmed_token)
    })
}

fn has_windows_drive_prefix(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(
        (chars.next(), chars.next(), chars.next()),
        (Some(drive_letter), Some(':'), Some('\\' | '/')) if drive_letter.is_ascii_alphabetic()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    #[cfg(windows)]
    use std::os::windows::process::ExitStatusExt;
    use std::process::ExitStatus;

    #[test]
    fn validates_supported_extensions() {
        assert!(is_supported_extension("mp4"));
        assert!(is_supported_extension("mp3"));
        assert!(is_supported_extension("m4a"));
        assert!(is_supported_extension("wav"));
        assert!(!is_supported_extension("webm"));
        assert!(!is_supported_extension("txt"));
    }

    #[test]
    fn normalizes_extension_case() {
        assert_eq!(normalized_extension(Path::new("/tmp/Sample.MP3")), "mp3");
    }

    #[test]
    fn builds_ffmpeg_args_without_shell_concatenation() {
        let args = ffmpeg_args(
            Path::new("/tmp/input file.mp3"),
            Path::new("/tmp/output file.wav"),
        );
        assert_eq!(args[0], "-y");
        assert_eq!(args[1], "-i");
        assert_eq!(args[2], "/tmp/input file.mp3");
        assert_eq!(
            args[3..9],
            ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]
        );
        assert_eq!(args[9], "/tmp/output file.wav");
    }

    #[test]
    fn hides_local_paths_from_process_log_summary() {
        let output = Output {
            status: successful_exit_status(),
            stdout: Vec::new(),
            stderr: b"Input #0, mp3, from '/Users/test/IELTS sample/audio file.mp3':\nInvalid data found when processing input\n".to_vec(),
        };

        let summary = summarize_process_output(&output);

        assert!(!summary.contains("/Users/test"));
        assert!(!summary.contains("audio file.mp3"));
        assert!(summary.contains("[已隐藏包含本地路径的转码日志行]"));
        assert!(summary.contains("Invalid data found when processing input"));
    }

    #[test]
    fn keeps_non_path_process_log_lines_with_slashes() {
        let output = Output {
            status: successful_exit_status(),
            stdout: Vec::new(),
            stderr: b"Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 128 kb/s\n".to_vec(),
        };

        let summary = summarize_process_output(&output);

        assert!(summary.contains("128 kb/s"));
        assert!(!summary.contains("[已隐藏包含本地路径的转码日志行]"));
    }

    #[cfg(unix)]
    fn successful_exit_status() -> ExitStatus {
        ExitStatus::from_raw(0)
    }

    #[cfg(windows)]
    fn successful_exit_status() -> ExitStatus {
        ExitStatus::from_raw(0)
    }
}
