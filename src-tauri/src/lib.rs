use serde::Serialize;
use tauri::AppHandle;

mod config;
mod constants;
mod corpus;
mod errors;
mod grading;
mod media;
mod speech;

pub(crate) use config::{read_config, StoredAzureConfig, StoredDeepSeekConfig, StoredZhipuConfig};
pub(crate) use constants::ZHIPU_EMBEDDING_DIMENSIONS;
pub(crate) use errors::AppError;

#[derive(Debug, Serialize)]
struct HealthCheckResult {
    ok: bool,
    version: String,
    platform: String,
}

#[tauri::command]
fn health_check() -> HealthCheckResult {
    HealthCheckResult {
        ok: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn validate_azure_config(app: AppHandle) -> Result<speech::AzureConfigValidationResult, AppError> {
    let config = read_config(&app)?;
    Ok(speech::validate_azure_config(&config.azure))
}

#[tauri::command]
async fn issue_azure_speech_token(app: AppHandle) -> Result<speech::AzureSpeechToken, AppError> {
    let config = read_config(&app)?;
    speech::issue_azure_speech_token(&config.azure).await
}

#[tauri::command]
async fn validate_deepseek_config(
    app: AppHandle,
) -> Result<grading::ConfigValidationResult, AppError> {
    let config = read_config(&app)?;
    grading::validate_deepseek_config(&config.deepseek).await
}

#[tauri::command]
async fn grade_speaking(
    app: AppHandle,
    request: grading::GradeRequest,
) -> Result<grading::GradeResult, AppError> {
    let config = read_config(&app)?;
    grading::grade_speaking(&config.deepseek, request).await
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            health_check,
            config::get_app_config,
            config::save_app_config,
            config::clear_deepseek_key,
            config::clear_zhipu_key,
            config::clear_azure_key,
            validate_azure_config,
            issue_azure_speech_token,
            validate_deepseek_config,
            grade_speaking,
            corpus::create_teacher_case,
            corpus::list_teacher_cases,
            corpus::get_teacher_case,
            corpus::update_teacher_case,
            corpus::delete_teacher_case,
            corpus::rebuild_teacher_case_embedding,
            corpus::search_teacher_cases,
            corpus::diagnose_teacher_case_search,
            media::select_media_file,
            media::get_media_metadata,
            media::transcode_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
