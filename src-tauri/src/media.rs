use crate::AppError;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp4", "mp3", "m4a", "wav"];
const AFCONVERT_PATH: &str = "/usr/bin/afconvert";
const AFINFO_PATH: &str = "/usr/bin/afinfo";
const GENERATED_MEDIA_DIRECTORY_NAME: &str = "generated-media";
const MAX_INPUT_BYTES: u64 = 500 * 1024 * 1024;
const MAX_MEDIA_DURATION_MS: u64 = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_GENERATED_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const PROCESS_LOG_LIMIT_BYTES: usize = 32 * 1024;
const AFINFO_TIMEOUT: Duration = Duration::from_secs(30);
const TRANSCODE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

static MEDIA_JOB_REGISTRY: OnceLock<Mutex<HashMap<String, Arc<MediaJobControl>>>> = OnceLock::new();
static GENERATED_MEDIA_LIFECYCLE: OnceLock<Mutex<GeneratedMediaLifecycle>> = OnceLock::new();

#[derive(Debug, Default)]
struct GeneratedMediaLifecycle {
    pending_published_paths: HashSet<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaImportRequest {
    job_id: String,
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
    duration_ms: u64,
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
    duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelMediaTranscodeResult {
    job_id: String,
    canceled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeneratedMediaReconcileResult {
    removed_files: u64,
    removed_bytes: u64,
    total_bytes: u64,
    capacity_bytes: u64,
}

#[derive(Debug, Default)]
struct MediaProbe {
    duration_ms: Option<u64>,
    sample_rate: Option<u32>,
    channels: Option<u8>,
    bit_depth: Option<u8>,
    format_type: Option<String>,
}

#[derive(Debug)]
struct MediaJobControl {
    canceled: AtomicBool,
    child: Mutex<Option<Child>>,
    partial_path: Mutex<Option<PathBuf>>,
    published_path: Mutex<Option<PathBuf>>,
    reserved_bytes: AtomicU64,
}

impl MediaJobControl {
    fn new() -> Self {
        Self {
            canceled: AtomicBool::new(false),
            child: Mutex::new(None),
            partial_path: Mutex::new(None),
            published_path: Mutex::new(None),
            reserved_bytes: AtomicU64::new(0),
        }
    }
}

struct RegisteredMediaJob {
    job_id: String,
    control: Arc<MediaJobControl>,
}

impl Drop for RegisteredMediaJob {
    fn drop(&mut self) {
        terminate_process(&self.control.child);

        let mut lifecycle = lock_unpoisoned(generated_media_lifecycle());

        if let Some(partial_path) = lock_unpoisoned(&self.control.partial_path).take() {
            let _ = fs::remove_file(partial_path);
        }
        if let Some(published_path) = lock_unpoisoned(&self.control.published_path).take() {
            if published_path.is_file() {
                lifecycle.pending_published_paths.insert(published_path);
            }
        }

        lock_unpoisoned(media_job_registry()).remove(&self.job_id);
    }
}

#[derive(Debug)]
struct ManagedProcessOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    _stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ManagedProcessFailure {
    Start,
    Busy,
    Canceled,
    TimedOut,
    OutputTooLarge,
}

#[tauri::command]
pub(crate) fn select_media_file() -> Result<Option<String>, AppError> {
    let file = rfd::FileDialog::new()
        .add_filter("Media", &["mp4", "mp3", "m4a", "wav"])
        .pick_file();

    Ok(file.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub(crate) async fn get_media_metadata(path: String) -> Result<MediaMetadata, AppError> {
    tauri::async_runtime::spawn_blocking(move || read_media_metadata(Path::new(path.trim()), true))
        .await
        .map_err(|_| {
            AppError::new(
                "MEDIA_METADATA_TASK_FAILED",
                "读取媒体文件信息的后台任务失败。",
            )
        })?
}

#[tauri::command]
pub(crate) async fn transcode_media(
    app: AppHandle,
    request: MediaImportRequest,
) -> Result<MediaTranscodeResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || transcode_media_impl(&app, request))
        .await
        .map_err(|_| AppError::new("MEDIA_TASK_FAILED", "媒体转码后台任务失败。"))?
}

#[tauri::command]
pub(crate) fn cancel_media_transcode(
    job_id: String,
) -> Result<CancelMediaTranscodeResult, AppError> {
    let normalized_job_id = normalize_job_id(&job_id)?;
    let control = lock_unpoisoned(media_job_registry())
        .get(&normalized_job_id)
        .cloned();

    if let Some(control) = control {
        control.canceled.store(true, Ordering::Release);
        if let Some(child) = lock_unpoisoned(&control.child).as_mut() {
            let _ = child.kill();
        }

        return Ok(CancelMediaTranscodeResult {
            job_id: normalized_job_id,
            canceled: true,
        });
    }

    Ok(CancelMediaTranscodeResult {
        job_id: normalized_job_id,
        canceled: false,
    })
}

#[tauri::command]
pub(crate) fn delete_generated_media_file(app: AppHandle, path: String) -> Result<bool, AppError> {
    let generated_media_directory = generated_media_directory(&app)?;
    let requested_path = PathBuf::from(path.trim());
    let mut lifecycle = lock_unpoisoned(generated_media_lifecycle());
    let Some(validated_path) =
        validated_generated_media_delete_path(&generated_media_directory, &requested_path)?
    else {
        lifecycle.pending_published_paths.remove(&requested_path);
        return Ok(false);
    };
    if active_generated_media_paths().contains(&validated_path) {
        return Err(AppError::new(
            "MEDIA_DELETE_ACTIVE",
            "媒体文件仍由运行中的任务持有，暂时无法删除。",
        ));
    }

    fs::remove_file(&validated_path)
        .map_err(|_| AppError::new("MEDIA_DELETE_FAILED", "删除生成的媒体文件失败。"))?;
    lifecycle.pending_published_paths.remove(&validated_path);
    Ok(true)
}

#[tauri::command]
pub(crate) fn reconcile_generated_media(
    app: AppHandle,
    referenced_paths: Vec<String>,
) -> Result<GeneratedMediaReconcileResult, AppError> {
    let generated_media_directory = generated_media_directory(&app)?;
    reconcile_generated_media_directory(&generated_media_directory, &referenced_paths)
}

fn transcode_media_impl(
    app: &AppHandle,
    request: MediaImportRequest,
) -> Result<MediaTranscodeResult, AppError> {
    let registered_job = register_media_job(&request.job_id)?;
    let requested_input_path = PathBuf::from(request.input_path.trim());
    let metadata = read_media_metadata(&requested_input_path, false)?;
    validate_media_input(&metadata)?;
    let input_path = PathBuf::from(&metadata.path);

    let input_probe = inspect_media(&input_path, Some(&registered_job.control))?;
    let input_duration_ms = input_probe.duration_ms.ok_or_else(|| {
        AppError::new(
            "MEDIA_DURATION_UNAVAILABLE",
            "无法确认媒体时长，已停止转码。",
        )
    })?;
    validate_media_duration(input_duration_ms)?;

    let generated_media_directory = generated_media_directory(app)?;
    reserve_generated_media_capacity(
        &generated_media_directory,
        &registered_job.control,
        MAX_OUTPUT_BYTES,
    )?;

    let media_id = Uuid::new_v4().to_string();
    let output_path = generated_media_directory.join(format!("{media_id}.wav"));
    let partial_path = generated_media_directory.join(format!("{media_id}.partial"));
    register_active_partial_path(&registered_job.control, &partial_path);

    let process_output = run_managed_process(
        AFCONVERT_PATH,
        &afconvert_args(&input_path, &partial_path),
        TRANSCODE_TIMEOUT,
        &registered_job.control,
        Some((&partial_path, MAX_OUTPUT_BYTES)),
    )
    .map_err(map_transcode_process_failure)?;

    if !process_output.status.success() {
        return Err(AppError::new("MEDIA_TRANSCODE_FAILED", "媒体转码失败。"));
    }

    let output_metadata = fs::metadata(&partial_path)
        .map_err(|_| AppError::new("MEDIA_OUTPUT_MISSING", "转码器未生成可用的 WAV 文件。"))?;
    if output_metadata.len() == 0 {
        return Err(AppError::new(
            "MEDIA_OUTPUT_EMPTY",
            "转码后的 WAV 文件为空。",
        ));
    }
    if output_metadata.len() > MAX_OUTPUT_BYTES {
        return Err(AppError::new(
            "MEDIA_OUTPUT_TOO_LARGE",
            "转码后的 WAV 文件超过 64 MiB 限制。",
        ));
    }

    let output_probe = inspect_media(&partial_path, Some(&registered_job.control))?;
    validate_transcoded_output(&output_probe)?;
    let output_duration_ms = output_probe.duration_ms.ok_or_else(|| {
        AppError::new(
            "MEDIA_OUTPUT_DURATION_UNAVAILABLE",
            "无法确认转码后 WAV 的时长。",
        )
    })?;

    sync_file(&partial_path)?;
    publish_generated_media_file(
        &generated_media_directory,
        &partial_path,
        &output_path,
        &registered_job.control,
    )?;

    Ok(MediaTranscodeResult {
        input_path: metadata.path,
        output_path: output_path.to_string_lossy().to_string(),
        format: "wav",
        sample_rate: 16000,
        channels: 1,
        codec: "pcm_s16le",
        duration_ms: output_duration_ms,
        log_summary: Some("macOS afconvert 转码完成。".to_string()),
    })
}

fn register_media_job(job_id: &str) -> Result<RegisteredMediaJob, AppError> {
    let normalized_job_id = normalize_job_id(job_id)?;
    let control = Arc::new(MediaJobControl::new());
    let mut registry = lock_unpoisoned(media_job_registry());
    if registry.contains_key(&normalized_job_id) {
        return Err(AppError::new(
            "MEDIA_JOB_ALREADY_EXISTS",
            "同一媒体任务已在运行。",
        ));
    }

    registry.insert(normalized_job_id.clone(), Arc::clone(&control));
    Ok(RegisteredMediaJob {
        job_id: normalized_job_id,
        control,
    })
}

fn normalize_job_id(job_id: &str) -> Result<String, AppError> {
    let parsed_job_id = Uuid::parse_str(job_id.trim())
        .map_err(|_| AppError::new("MEDIA_JOB_ID_INVALID", "媒体任务 ID 无效。"))?;
    Ok(parsed_job_id.to_string())
}

fn media_job_registry() -> &'static Mutex<HashMap<String, Arc<MediaJobControl>>> {
    MEDIA_JOB_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn generated_media_lifecycle() -> &'static Mutex<GeneratedMediaLifecycle> {
    GENERATED_MEDIA_LIFECYCLE.get_or_init(|| Mutex::new(GeneratedMediaLifecycle::default()))
}

fn register_active_partial_path(control: &Arc<MediaJobControl>, partial_path: &Path) {
    let _lifecycle = lock_unpoisoned(generated_media_lifecycle());
    *lock_unpoisoned(&control.partial_path) = Some(partial_path.to_path_buf());
}

fn publish_generated_media_file(
    directory: &Path,
    partial_path: &Path,
    output_path: &Path,
    control: &Arc<MediaJobControl>,
) -> Result<(), AppError> {
    let _lifecycle = lock_unpoisoned(generated_media_lifecycle());
    if control.canceled.load(Ordering::Acquire) {
        return Err(AppError::new("MEDIA_CANCELED", "媒体转码已取消。"));
    }

    fs::rename(partial_path, output_path)
        .map_err(|_| AppError::new("MEDIA_OUTPUT_PUBLISH_FAILED", "无法发布转码后的 WAV 文件。"))?;
    if let Err(error) = sync_directory(directory) {
        let _ = fs::remove_file(output_path);
        *lock_unpoisoned(&control.partial_path) = None;
        return Err(error);
    }

    *lock_unpoisoned(&control.partial_path) = None;
    *lock_unpoisoned(&control.published_path) = Some(output_path.to_path_buf());
    Ok(())
}

fn active_generated_media_paths() -> HashSet<PathBuf> {
    lock_unpoisoned(media_job_registry())
        .values()
        .flat_map(|control| {
            let partial_path = lock_unpoisoned(&control.partial_path).clone();
            let published_path = lock_unpoisoned(&control.published_path).clone();
            partial_path.into_iter().chain(published_path)
        })
        .collect()
}

fn read_media_metadata(path: &Path, include_duration: bool) -> Result<MediaMetadata, AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::new("MEDIA_PATH_EMPTY", "媒体文件路径不能为空。"));
    }

    let canonical_path = fs::canonicalize(path)
        .map_err(|_| AppError::new("MEDIA_FILE_NOT_FOUND", "无法读取媒体文件。"))?;
    let raw_metadata = fs::metadata(&canonical_path)
        .map_err(|_| AppError::new("MEDIA_FILE_NOT_FOUND", "无法读取媒体文件。"))?;

    if !raw_metadata.is_file() {
        return Err(AppError::new("MEDIA_NOT_FILE", "请选择一个媒体文件。"));
    }

    let extension = normalized_extension(&canonical_path);
    let supported = is_supported_extension(&extension);
    let duration_ms = if include_duration && supported {
        inspect_media(&canonical_path, None)
            .ok()
            .and_then(|probe| probe.duration_ms)
    } else {
        None
    };

    Ok(MediaMetadata {
        path: canonical_path.to_string_lossy().to_string(),
        file_name: canonical_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "media".to_string()),
        supported,
        extension,
        size_bytes: raw_metadata.len(),
        duration_ms,
    })
}

fn validate_media_input(metadata: &MediaMetadata) -> Result<(), AppError> {
    if !metadata.supported {
        return Err(AppError::new(
            "MEDIA_UNSUPPORTED_TYPE",
            "仅支持 MP4、MP3、M4A 和 WAV 文件。",
        ));
    }
    if metadata.size_bytes == 0 {
        return Err(AppError::new("MEDIA_EMPTY_FILE", "媒体文件为空。"));
    }
    if metadata.size_bytes > MAX_INPUT_BYTES {
        return Err(AppError::new(
            "MEDIA_INPUT_TOO_LARGE",
            "媒体文件超过 500 MiB 限制。",
        ));
    }

    Ok(())
}

fn validate_media_duration(duration_ms: u64) -> Result<(), AppError> {
    if duration_ms == 0 {
        return Err(AppError::new("MEDIA_DURATION_INVALID", "媒体时长无效。"));
    }
    if duration_ms > MAX_MEDIA_DURATION_MS {
        return Err(AppError::new(
            "MEDIA_DURATION_TOO_LONG",
            "媒体时长超过 30 分钟限制。",
        ));
    }

    Ok(())
}

fn validate_transcoded_output(probe: &MediaProbe) -> Result<(), AppError> {
    validate_media_duration(probe.duration_ms.unwrap_or(0))?;
    let output_is_expected_pcm = probe.sample_rate == Some(16_000)
        && probe.channels == Some(1)
        && probe.bit_depth == Some(16)
        && probe.format_type.as_deref() == Some("lpcm");
    if !output_is_expected_pcm {
        return Err(AppError::new(
            "MEDIA_OUTPUT_FORMAT_INVALID",
            "转码后的文件不是 16kHz、16-bit、单声道 PCM WAV。",
        ));
    }

    Ok(())
}

fn normalized_extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_supported_extension(extension: &str) -> bool {
    SUPPORTED_EXTENSIONS.contains(&extension)
}

fn afconvert_args(input: &Path, output: &Path) -> Vec<OsString> {
    vec![
        OsString::from("-f"),
        OsString::from("WAVE"),
        OsString::from("-d"),
        OsString::from("LEI16@16000"),
        OsString::from("-c"),
        OsString::from("1"),
        input.as_os_str().to_owned(),
        output.as_os_str().to_owned(),
    ]
}

fn inspect_media(
    path: &Path,
    job_control: Option<&Arc<MediaJobControl>>,
) -> Result<MediaProbe, AppError> {
    let standalone_control = Arc::new(MediaJobControl::new());
    let process_control = job_control.unwrap_or(&standalone_control);
    let args = [
        OsString::from("-x"),
        OsString::from("-r"),
        path.as_os_str().to_owned(),
    ];
    let process_output =
        run_managed_process(AFINFO_PATH, &args, AFINFO_TIMEOUT, process_control, None)
            .map_err(map_afinfo_process_failure)?;
    if !process_output.status.success() {
        return Err(AppError::new(
            "MEDIA_INSPECTION_FAILED",
            "无法读取媒体时长和音频格式。",
        ));
    }

    parse_afinfo_xml(&process_output.stdout)
}

fn parse_afinfo_xml(xml: &[u8]) -> Result<MediaProbe, AppError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut current_element = String::new();
    let mut probe = MediaProbe::default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => {
                current_element =
                    String::from_utf8_lossy(element.local_name().as_ref()).to_string();
            }
            Ok(Event::Text(text)) => {
                let value = text.decode().map_err(|_| {
                    AppError::new("MEDIA_INSPECTION_XML_INVALID", "媒体信息 XML 无法解析。")
                })?;
                match current_element.as_str() {
                    "duration" => {
                        probe.duration_ms = parse_duration_ms(&value);
                    }
                    "sample_rate" => {
                        probe.sample_rate = value
                            .parse::<f64>()
                            .ok()
                            .filter(|sample_rate| sample_rate.is_finite() && *sample_rate > 0.0)
                            .map(|sample_rate| sample_rate.round() as u32);
                    }
                    "num_channels" => {
                        probe.channels = value.parse::<u8>().ok();
                    }
                    "bit_depth" => {
                        probe.bit_depth = value.parse::<u8>().ok();
                    }
                    "format_type" => {
                        probe.format_type = Some(value.to_ascii_lowercase());
                    }
                    _ => {}
                }
            }
            Ok(Event::End(_)) => current_element.clear(),
            Ok(Event::Eof) => break,
            Err(_) => {
                return Err(AppError::new(
                    "MEDIA_INSPECTION_XML_INVALID",
                    "媒体信息 XML 无法解析。",
                ));
            }
            _ => {}
        }
    }

    if probe.duration_ms.is_none() {
        return Err(AppError::new(
            "MEDIA_DURATION_UNAVAILABLE",
            "媒体信息中缺少有效时长。",
        ));
    }

    Ok(probe)
}

fn parse_duration_ms(value: &str) -> Option<u64> {
    value
        .parse::<f64>()
        .ok()
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .map(|seconds| (seconds * 1000.0).round() as u64)
}

fn run_managed_process(
    executable: &str,
    args: &[OsString],
    timeout: Duration,
    control: &Arc<MediaJobControl>,
    monitored_output: Option<(&Path, u64)>,
) -> Result<ManagedProcessOutput, ManagedProcessFailure> {
    if control.canceled.load(Ordering::Acquire) {
        return Err(ManagedProcessFailure::Canceled);
    }

    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|_| ManagedProcessFailure::Start)?;
    let stdout_reader = spawn_capped_reader(child.stdout.take());
    let stderr_reader = spawn_capped_reader(child.stderr.take());

    {
        let mut active_child = lock_unpoisoned(&control.child);
        if active_child.is_some() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ManagedProcessFailure::Busy);
        }
        *active_child = Some(child);
    }

    let started_at = Instant::now();
    let process_result = loop {
        if control.canceled.load(Ordering::Acquire) {
            terminate_process(&control.child);
            break Err(ManagedProcessFailure::Canceled);
        }

        if started_at.elapsed() >= timeout {
            terminate_process(&control.child);
            break Err(ManagedProcessFailure::TimedOut);
        }

        if let Some((output_path, maximum_bytes)) = monitored_output {
            if fs::metadata(output_path)
                .map(|metadata| metadata.len() > maximum_bytes)
                .unwrap_or(false)
            {
                terminate_process(&control.child);
                break Err(ManagedProcessFailure::OutputTooLarge);
            }
        }

        let process_status = {
            let mut active_child = lock_unpoisoned(&control.child);
            active_child
                .as_mut()
                .and_then(|child| child.try_wait().ok())
                .flatten()
        };
        if let Some(status) = process_status {
            lock_unpoisoned(&control.child).take();
            break Ok(status);
        }

        thread::sleep(PROCESS_POLL_INTERVAL);
    };

    let stdout = join_capped_reader(stdout_reader);
    let stderr = join_capped_reader(stderr_reader);
    process_result.map(|status| ManagedProcessOutput {
        status,
        stdout,
        _stderr: stderr,
    })
}

fn spawn_capped_reader<R>(reader: Option<R>) -> thread::JoinHandle<Vec<u8>>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Some(mut reader) = reader else {
            return Vec::new();
        };

        let mut retained = Vec::with_capacity(PROCESS_LOG_LIMIT_BYTES);
        let mut buffer = [0_u8; 8192];
        loop {
            let bytes_read = match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(bytes_read) => bytes_read,
            };
            let remaining_capacity = PROCESS_LOG_LIMIT_BYTES.saturating_sub(retained.len());
            if remaining_capacity > 0 {
                retained.extend_from_slice(&buffer[..bytes_read.min(remaining_capacity)]);
            }
        }
        retained
    })
}

fn join_capped_reader(reader: thread::JoinHandle<Vec<u8>>) -> Vec<u8> {
    reader.join().unwrap_or_default()
}

fn terminate_process(child_slot: &Mutex<Option<Child>>) {
    if let Some(mut child) = lock_unpoisoned(child_slot).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn map_afinfo_process_failure(failure: ManagedProcessFailure) -> AppError {
    match failure {
        ManagedProcessFailure::Canceled => AppError::new("MEDIA_CANCELED", "媒体处理已取消。"),
        ManagedProcessFailure::TimedOut => {
            AppError::new("MEDIA_INSPECTION_TIMED_OUT", "读取媒体信息超过 30 秒限制。")
        }
        ManagedProcessFailure::Start => {
            AppError::new("MEDIA_AFINFO_UNAVAILABLE", "无法启动系统媒体信息工具。")
        }
        ManagedProcessFailure::Busy => {
            AppError::new("MEDIA_JOB_PROCESS_BUSY", "媒体任务状态异常。")
        }
        ManagedProcessFailure::OutputTooLarge => {
            AppError::new("MEDIA_INSPECTION_TOO_LARGE", "媒体信息输出超过限制。")
        }
    }
}

fn map_transcode_process_failure(failure: ManagedProcessFailure) -> AppError {
    match failure {
        ManagedProcessFailure::Canceled => AppError::new("MEDIA_CANCELED", "媒体转码已取消。"),
        ManagedProcessFailure::TimedOut => {
            AppError::new("MEDIA_TRANSCODE_TIMED_OUT", "媒体转码超过 10 分钟限制。")
        }
        ManagedProcessFailure::OutputTooLarge => AppError::new(
            "MEDIA_OUTPUT_TOO_LARGE",
            "转码后的 WAV 文件超过 64 MiB 限制。",
        ),
        ManagedProcessFailure::Start => AppError::new(
            "MEDIA_AFCONVERT_UNAVAILABLE",
            "无法启动 macOS 系统转码工具。",
        ),
        ManagedProcessFailure::Busy => {
            AppError::new("MEDIA_JOB_PROCESS_BUSY", "媒体任务状态异常。")
        }
    }
}

fn generated_media_directory(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::new("MEDIA_APP_DATA_PATH_FAILED", "无法定位应用数据目录。"))?;
    let generated_media_directory = app_data_directory.join(GENERATED_MEDIA_DIRECTORY_NAME);
    fs::create_dir_all(&generated_media_directory)
        .map_err(|_| AppError::new("MEDIA_DIRECTORY_CREATE_FAILED", "创建生成媒体目录失败。"))?;
    set_private_directory_permissions(&generated_media_directory)?;
    fs::canonicalize(&generated_media_directory)
        .map_err(|_| AppError::new("MEDIA_DIRECTORY_VERIFY_FAILED", "无法验证生成媒体目录。"))
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| {
        AppError::new(
            "MEDIA_DIRECTORY_PERMISSION_FAILED",
            "无法保护生成媒体目录。",
        )
    })
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

fn reserve_generated_media_capacity(
    directory: &Path,
    control: &Arc<MediaJobControl>,
    requested_bytes: u64,
) -> Result<(), AppError> {
    let registry = lock_unpoisoned(media_job_registry());
    let active_reservations = registry
        .values()
        .filter(|registered_control| !Arc::ptr_eq(registered_control, control))
        .map(|registered_control| registered_control.reserved_bytes.load(Ordering::Acquire))
        .sum::<u64>();
    let current_usage = generated_media_usage(directory)?;
    if !has_generated_media_capacity(current_usage, active_reservations, requested_bytes) {
        return Err(AppError::new(
            "MEDIA_CAPACITY_EXCEEDED",
            "生成媒体目录已接近 2 GiB 上限，请删除不再需要的历史记录后重试。",
        ));
    }

    control
        .reserved_bytes
        .store(requested_bytes, Ordering::Release);
    Ok(())
}

fn has_generated_media_capacity(
    current_usage: u64,
    active_reservations: u64,
    requested_bytes: u64,
) -> bool {
    current_usage
        .saturating_add(active_reservations)
        .saturating_add(requested_bytes)
        <= MAX_GENERATED_MEDIA_BYTES
}

fn generated_media_usage(directory: &Path) -> Result<u64, AppError> {
    let entries = fs::read_dir(directory)
        .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;
    let mut total_bytes = 0_u64;
    for entry in entries {
        let entry = entry
            .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;
        let metadata = entry
            .metadata()
            .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;
        if metadata.is_file() {
            total_bytes = total_bytes.saturating_add(metadata.len());
        }
    }
    Ok(total_bytes)
}

fn reconcile_generated_media_directory(
    directory: &Path,
    referenced_paths: &[String],
) -> Result<GeneratedMediaReconcileResult, AppError> {
    reconcile_generated_media_directory_with_snapshot_hook(directory, referenced_paths, || {})
}

fn reconcile_generated_media_directory_with_snapshot_hook<F>(
    directory: &Path,
    referenced_paths: &[String],
    after_ownership_snapshot: F,
) -> Result<GeneratedMediaReconcileResult, AppError>
where
    F: FnOnce(),
{
    let mut lifecycle = lock_unpoisoned(generated_media_lifecycle());
    let referenced_generated_media_paths = referenced_paths
        .iter()
        .filter_map(|path| {
            let path = Path::new(path.trim());
            is_direct_generated_wav_path(directory, path).then(|| path.to_path_buf())
        })
        .collect::<HashSet<_>>();
    for referenced_path in &referenced_generated_media_paths {
        lifecycle.pending_published_paths.remove(referenced_path);
    }

    let active_generated_media_paths = active_generated_media_paths();
    let pending_published_paths = lifecycle
        .pending_published_paths
        .iter()
        .filter(|path| path.parent() == Some(directory))
        .cloned()
        .collect::<HashSet<_>>();
    after_ownership_snapshot();

    let mut removed_files = 0_u64;
    let mut removed_bytes = 0_u64;
    let entries = fs::read_dir(directory)
        .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;

    for entry in entries {
        let entry = entry
            .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;
        let path = entry.path();
        let file_name = entry.file_name();
        let metadata = entry
            .metadata()
            .map_err(|_| AppError::new("MEDIA_DIRECTORY_READ_FAILED", "无法读取生成媒体目录。"))?;
        if !metadata.is_file() {
            continue;
        }

        let remove_partial = path.extension().and_then(|value| value.to_str()) == Some("partial")
            && !active_generated_media_paths.contains(&path);
        let remove_orphan_wav = is_generated_wav_name(&file_name)
            && !referenced_generated_media_paths.contains(&path)
            && !active_generated_media_paths.contains(&path)
            && !pending_published_paths.contains(&path);
        if !remove_partial && !remove_orphan_wav {
            continue;
        }

        fs::remove_file(&path).map_err(|_| {
            AppError::new(
                "MEDIA_RECONCILE_DELETE_FAILED",
                "清理未引用的生成媒体失败。",
            )
        })?;
        lifecycle.pending_published_paths.remove(&path);
        removed_files += 1;
        removed_bytes = removed_bytes.saturating_add(metadata.len());
    }

    Ok(GeneratedMediaReconcileResult {
        removed_files,
        removed_bytes,
        total_bytes: generated_media_usage(directory)?,
        capacity_bytes: MAX_GENERATED_MEDIA_BYTES,
    })
}

fn is_direct_generated_wav_path(directory: &Path, path: &Path) -> bool {
    path.parent() == Some(directory) && path.file_name().map(is_generated_wav_name).unwrap_or(false)
}

fn validated_generated_media_delete_path(
    generated_media_root: &Path,
    requested_path: &Path,
) -> Result<Option<PathBuf>, AppError> {
    let root_metadata = fs::symlink_metadata(generated_media_root)
        .map_err(|_| generated_media_delete_path_rejected())?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(generated_media_delete_path_rejected());
    }
    let canonical_root = fs::canonicalize(generated_media_root)
        .map_err(|_| generated_media_delete_path_rejected())?;
    if canonical_root != generated_media_root {
        return Err(generated_media_delete_path_rejected());
    }

    if !is_direct_generated_wav_path(generated_media_root, requested_path) {
        return Err(generated_media_delete_path_rejected());
    }

    let requested_metadata = match fs::symlink_metadata(requested_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(generated_media_delete_path_rejected()),
    };
    if requested_metadata.file_type().is_symlink() || !requested_metadata.is_file() {
        return Err(generated_media_delete_path_rejected());
    }

    let canonical_requested_path =
        fs::canonicalize(requested_path).map_err(|_| generated_media_delete_path_rejected())?;
    if canonical_requested_path.parent() != Some(canonical_root.as_path()) {
        return Err(generated_media_delete_path_rejected());
    }

    Ok(Some(canonical_requested_path))
}

fn generated_media_delete_path_rejected() -> AppError {
    AppError::new(
        "MEDIA_DELETE_PATH_REJECTED",
        "只能删除应用生成的 WAV 文件。",
    )
}

fn is_generated_wav_name(file_name: &std::ffi::OsStr) -> bool {
    let path = Path::new(file_name);
    path.extension().and_then(|value| value.to_str()) == Some("wav")
        && path
            .file_stem()
            .and_then(|value| value.to_str())
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_some()
}

fn sync_file(path: &Path) -> Result<(), AppError> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(|_| AppError::new("MEDIA_OUTPUT_SYNC_FAILED", "无法同步转码后的 WAV 文件。"))
}

fn sync_directory(path: &Path) -> Result<(), AppError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| AppError::new("MEDIA_DIRECTORY_SYNC_FAILED", "无法同步生成媒体目录。"))
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::{mpsc, Barrier};
    use tempfile::tempdir;

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
    fn builds_afconvert_args_without_shell_concatenation() {
        let args = afconvert_args(
            Path::new("/tmp/input file.mp3"),
            Path::new("/tmp/output file.partial"),
        );

        assert_eq!(args[0], "-f");
        assert_eq!(args[1], "WAVE");
        assert_eq!(args[2], "-d");
        assert_eq!(args[3], "LEI16@16000");
        assert_eq!(args[6], "/tmp/input file.mp3");
        assert_eq!(args[7], "/tmp/output file.partial");
    }

    #[test]
    fn parses_afinfo_xml_metadata() {
        let xml = br#"<?xml version="1.0" encoding="UTF8"?>
          <audio_info><audio_file><tracks><track>
            <num_channels>1</num_channels>
            <sample_rate units="Hz">16000</sample_rate>
            <format_type>lpcm</format_type>
            <bit_depth units="bits">16</bit_depth>
            <duration units="sec">35.1255</duration>
          </track></tracks></audio_file></audio_info>"#;

        let probe = parse_afinfo_xml(xml).expect("valid afinfo XML");

        assert_eq!(probe.duration_ms, Some(35_126));
        assert_eq!(probe.sample_rate, Some(16_000));
        assert_eq!(probe.channels, Some(1));
        assert_eq!(probe.bit_depth, Some(16));
        assert_eq!(probe.format_type.as_deref(), Some("lpcm"));
    }

    #[test]
    fn rejects_afinfo_xml_without_duration() {
        let error = parse_afinfo_xml(b"<audio_info><sample_rate>16000</sample_rate></audio_info>")
            .expect_err("duration is required");

        assert_eq!(error.code, "MEDIA_DURATION_UNAVAILABLE");
    }

    #[test]
    fn enforces_input_duration_and_directory_capacity_limits() {
        let oversized_metadata = MediaMetadata {
            path: "/tmp/input.wav".to_string(),
            file_name: "input.wav".to_string(),
            extension: "wav".to_string(),
            size_bytes: MAX_INPUT_BYTES + 1,
            supported: true,
            duration_ms: None,
        };
        assert_eq!(
            validate_media_input(&oversized_metadata)
                .expect_err("oversized input must be rejected")
                .code,
            "MEDIA_INPUT_TOO_LARGE"
        );
        assert_eq!(
            validate_media_duration(MAX_MEDIA_DURATION_MS + 1)
                .expect_err("long input must be rejected")
                .code,
            "MEDIA_DURATION_TOO_LONG"
        );
        assert!(has_generated_media_capacity(
            MAX_GENERATED_MEDIA_BYTES - 1,
            0,
            1
        ));
        assert!(!has_generated_media_capacity(
            MAX_GENERATED_MEDIA_BYTES - 1,
            0,
            2
        ));
    }

    #[test]
    fn recognizes_only_uuid_wav_names() {
        assert!(is_generated_wav_name(std::ffi::OsStr::new(
            "123e4567-e89b-12d3-a456-426614174000.wav"
        )));
        assert!(!is_generated_wav_name(std::ffi::OsStr::new("sample.wav")));
        assert!(!is_generated_wav_name(std::ffi::OsStr::new(
            "123e4567-e89b-12d3-a456-426614174000.partial"
        )));
    }

    #[test]
    fn validates_only_direct_regular_uuid_wav_delete_paths() {
        let temporary_directory = tempdir().expect("create temp directory");
        let generated_media_root = temporary_directory.path().join("generated-media");
        fs::create_dir(&generated_media_root).expect("create generated media root");
        let generated_media_root =
            fs::canonicalize(generated_media_root).expect("canonicalize generated media root");
        let valid_path = generated_media_root.join(format!("{}.wav", Uuid::new_v4()));
        fs::write(&valid_path, b"generated wav").expect("write generated WAV");

        let validated_path =
            validated_generated_media_delete_path(&generated_media_root, &valid_path)
                .expect("validate generated WAV delete path");
        assert_eq!(validated_path, Some(valid_path.clone()));

        let missing_path = generated_media_root.join(format!("{}.wav", Uuid::new_v4()));
        assert_eq!(
            validated_generated_media_delete_path(&generated_media_root, &missing_path)
                .expect("missing generated WAV remains idempotent"),
            None
        );
    }

    #[test]
    fn rejects_traversal_nested_non_uuid_and_directory_delete_paths() {
        let temporary_directory = tempdir().expect("create temp directory");
        let generated_media_root = temporary_directory.path().join("generated-media");
        fs::create_dir(&generated_media_root).expect("create generated media root");
        let generated_media_root =
            fs::canonicalize(generated_media_root).expect("canonicalize generated media root");

        let external_path = temporary_directory
            .path()
            .join(format!("{}.wav", Uuid::new_v4()));
        fs::write(&external_path, b"external WAV").expect("write external WAV");
        let traversal_path = generated_media_root
            .join("..")
            .join(external_path.file_name().expect("external file name"));
        assert_delete_path_rejected(&generated_media_root, &traversal_path);

        let nested_directory = generated_media_root.join("nested");
        fs::create_dir(&nested_directory).expect("create nested directory");
        let nested_path = nested_directory.join(format!("{}.wav", Uuid::new_v4()));
        fs::write(&nested_path, b"nested WAV").expect("write nested WAV");
        assert_delete_path_rejected(&generated_media_root, &nested_path);

        let non_uuid_path = generated_media_root.join("recording.wav");
        fs::write(&non_uuid_path, b"non UUID WAV").expect("write non-UUID WAV");
        assert_delete_path_rejected(&generated_media_root, &non_uuid_path);

        let directory_path = generated_media_root.join(format!("{}.wav", Uuid::new_v4()));
        fs::create_dir(&directory_path).expect("create UUID-named directory");
        assert_delete_path_rejected(&generated_media_root, &directory_path);

        assert_eq!(
            fs::read(&external_path).expect("external target remains readable"),
            b"external WAV"
        );
        assert!(nested_path.exists());
        assert!(non_uuid_path.exists());
        assert!(directory_path.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_generated_media_symlink_without_deleting_external_target() {
        use std::os::unix::fs::symlink;

        let temporary_directory = tempdir().expect("create temp directory");
        let generated_media_root = temporary_directory.path().join("generated-media");
        fs::create_dir(&generated_media_root).expect("create generated media root");
        let generated_media_root =
            fs::canonicalize(generated_media_root).expect("canonicalize generated media root");
        let external_path = temporary_directory.path().join("external.wav");
        fs::write(&external_path, b"external target").expect("write external target");
        let symlink_path = generated_media_root.join(format!("{}.wav", Uuid::new_v4()));
        symlink(&external_path, &symlink_path).expect("create external symlink");

        assert_delete_path_rejected(&generated_media_root, &symlink_path);
        assert_eq!(
            fs::read(&external_path).expect("external target remains readable"),
            b"external target"
        );
        assert!(fs::symlink_metadata(&symlink_path)
            .expect("symlink remains present")
            .file_type()
            .is_symlink());
    }

    fn assert_delete_path_rejected(generated_media_root: &Path, requested_path: &Path) {
        let error = validated_generated_media_delete_path(generated_media_root, requested_path)
            .expect_err("delete path must be rejected");
        assert_eq!(error.code, "MEDIA_DELETE_PATH_REJECTED");
    }

    #[test]
    fn drains_stream_but_retains_only_32_kib() {
        let bytes = vec![b'x'; PROCESS_LOG_LIMIT_BYTES * 4];
        let retained = join_capped_reader(spawn_capped_reader(Some(Cursor::new(bytes))));

        assert_eq!(retained.len(), PROCESS_LOG_LIMIT_BYTES);
    }

    #[test]
    fn times_out_and_reaps_a_long_running_process() {
        let control = Arc::new(MediaJobControl::new());
        let started_at = Instant::now();
        let result = run_managed_process(
            "/bin/sleep",
            &[OsString::from("1")],
            Duration::from_millis(25),
            &control,
            None,
        );

        assert_eq!(
            result.expect_err("process must time out"),
            ManagedProcessFailure::TimedOut
        );
        assert!(started_at.elapsed() < Duration::from_secs(1));
        assert!(lock_unpoisoned(&control.child).is_none());
    }

    #[test]
    fn cancellation_is_idempotent_and_job_drop_removes_partial_output() {
        let job_id = Uuid::new_v4().to_string();
        let registered_job = register_media_job(&job_id).expect("register media job");
        let temporary_directory = tempdir().expect("create temp directory");
        let partial_path = temporary_directory.path().join("job.partial");
        register_active_partial_path(&registered_job.control, &partial_path);
        fs::write(&partial_path, b"partial output").expect("create partial output");

        let first_cancel = cancel_media_transcode(job_id.clone()).expect("first cancellation");
        let second_cancel = cancel_media_transcode(job_id.clone()).expect("second cancellation");
        assert!(first_cancel.canceled);
        assert!(second_cancel.canceled);

        drop(registered_job);
        assert!(!partial_path.exists());
        let after_completion = cancel_media_transcode(job_id).expect("completed cancellation");
        assert!(!after_completion.canceled);
    }

    #[test]
    fn reconcile_removes_only_partials_and_unreferenced_uuid_wavs() {
        let temporary_directory = tempdir().expect("create temp directory");
        let referenced_path = temporary_directory
            .path()
            .join(format!("{}.wav", Uuid::new_v4()));
        let orphan_path = temporary_directory
            .path()
            .join(format!("{}.wav", Uuid::new_v4()));
        let partial_path = temporary_directory
            .path()
            .join(format!("{}.partial", Uuid::new_v4()));
        let unrelated_path = temporary_directory.path().join("notes.txt");
        fs::write(&referenced_path, b"referenced").expect("write referenced WAV");
        fs::write(&orphan_path, b"orphan").expect("write orphan WAV");
        fs::write(&partial_path, b"partial").expect("write partial");
        fs::write(&unrelated_path, b"unrelated").expect("write unrelated file");

        let result = reconcile_generated_media_directory(
            temporary_directory.path(),
            &[referenced_path.to_string_lossy().to_string()],
        )
        .expect("reconcile generated media");

        assert_eq!(result.removed_files, 2);
        assert!(referenced_path.exists());
        assert!(!orphan_path.exists());
        assert!(!partial_path.exists());
        assert!(unrelated_path.exists());
    }

    #[test]
    fn reconcile_preserves_the_partial_file_of_an_active_job() {
        let temporary_directory = tempdir().expect("create temp directory");
        let job_id = Uuid::new_v4().to_string();
        let registered_job = register_media_job(&job_id).expect("register media job");
        let active_partial_path = temporary_directory
            .path()
            .join(format!("{}.partial", Uuid::new_v4()));
        register_active_partial_path(&registered_job.control, &active_partial_path);
        fs::write(&active_partial_path, b"active partial").expect("write active partial");

        let result = reconcile_generated_media_directory(temporary_directory.path(), &[])
            .expect("reconcile generated media");

        assert_eq!(result.removed_files, 0);
        assert!(active_partial_path.exists());
        drop(registered_job);
        assert!(!active_partial_path.exists());
    }

    #[test]
    fn reconcile_serializes_partial_creation_after_ownership_snapshot() {
        let temporary_directory = tempdir().expect("create temp directory");
        let generated_media_directory = temporary_directory.path().to_path_buf();
        let job_id = Uuid::new_v4().to_string();
        let registered_job = register_media_job(&job_id).expect("register media job");
        let active_partial_path =
            generated_media_directory.join(format!("{}.partial", Uuid::new_v4()));
        let ownership_snapshot_reached = Arc::new(Barrier::new(2));
        let allow_reconcile_to_continue = Arc::new(Barrier::new(2));
        let snapshot_barrier = Arc::clone(&ownership_snapshot_reached);
        let continue_barrier = Arc::clone(&allow_reconcile_to_continue);
        let reconcile_directory = generated_media_directory.clone();
        let reconcile_thread = thread::spawn(move || {
            reconcile_generated_media_directory_with_snapshot_hook(
                &reconcile_directory,
                &[],
                || {
                    snapshot_barrier.wait();
                    continue_barrier.wait();
                },
            )
            .expect("reconcile generated media")
        });

        ownership_snapshot_reached.wait();
        let partial_control = Arc::clone(&registered_job.control);
        let partial_path_for_thread = active_partial_path.clone();
        let partial_creation_started = Arc::new(Barrier::new(2));
        let partial_creation_barrier = Arc::clone(&partial_creation_started);
        let (partial_created_sender, partial_created_receiver) = mpsc::channel();
        let partial_creation_thread = thread::spawn(move || {
            partial_creation_barrier.wait();
            register_active_partial_path(&partial_control, &partial_path_for_thread);
            fs::write(&partial_path_for_thread, b"active partial").expect("write active partial");
            partial_created_sender
                .send(())
                .expect("signal partial creation");
        });
        partial_creation_started.wait();
        assert!(partial_created_receiver
            .recv_timeout(Duration::from_millis(100))
            .is_err());

        allow_reconcile_to_continue.wait();
        let reconcile_result = reconcile_thread.join().expect("join reconcile thread");
        assert_eq!(reconcile_result.removed_files, 0);
        partial_created_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("partial creation completes after reconciliation");
        partial_creation_thread
            .join()
            .expect("join partial creation thread");
        assert!(active_partial_path.exists());

        let second_reconcile = reconcile_generated_media_directory(&generated_media_directory, &[])
            .expect("reconcile active partial");
        assert_eq!(second_reconcile.removed_files, 0);
        assert!(active_partial_path.exists());

        drop(registered_job);
        assert!(!active_partial_path.exists());
    }

    #[test]
    fn reconcile_preserves_published_output_before_command_return_and_history_claim() {
        let temporary_directory = tempdir().expect("create temp directory");
        let generated_media_directory = temporary_directory.path().to_path_buf();
        let job_id = Uuid::new_v4().to_string();
        let registered_job = register_media_job(&job_id).expect("register media job");
        let media_id = Uuid::new_v4();
        let partial_path = generated_media_directory.join(format!("{media_id}.partial"));
        let published_path = generated_media_directory.join(format!("{media_id}.wav"));
        register_active_partial_path(&registered_job.control, &partial_path);
        fs::write(&partial_path, b"published output").expect("write partial output");
        publish_generated_media_file(
            &generated_media_directory,
            &partial_path,
            &published_path,
            &registered_job.control,
        )
        .expect("publish generated media");

        let start_reconcile = Arc::new(Barrier::new(2));
        let reconcile_barrier = Arc::clone(&start_reconcile);
        let reconcile_directory = generated_media_directory.clone();
        let reconcile_thread = thread::spawn(move || {
            reconcile_barrier.wait();
            reconcile_generated_media_directory(&reconcile_directory, &[])
                .expect("reconcile active published output")
        });
        start_reconcile.wait();
        let active_reconcile_result = reconcile_thread.join().expect("join reconcile thread");
        assert_eq!(active_reconcile_result.removed_files, 0);
        assert!(published_path.exists());

        drop(registered_job);
        let pending_reconcile =
            reconcile_generated_media_directory(&generated_media_directory, &[])
                .expect("reconcile pending published output");
        assert_eq!(pending_reconcile.removed_files, 0);
        assert!(published_path.exists());

        let referenced_path = published_path.to_string_lossy().to_string();
        let claimed_reconcile = reconcile_generated_media_directory(
            &generated_media_directory,
            std::slice::from_ref(&referenced_path),
        )
        .expect("claim published output from history");
        assert_eq!(claimed_reconcile.removed_files, 0);
        assert!(published_path.exists());

        let orphan_reconcile = reconcile_generated_media_directory(&generated_media_directory, &[])
            .expect("remove unreferenced claimed output");
        assert_eq!(orphan_reconcile.removed_files, 1);
        assert!(!published_path.exists());
    }
}
