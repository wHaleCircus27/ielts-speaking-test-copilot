use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

mod grading;
mod media;

#[derive(Debug, Serialize)]
pub(crate) struct AppError {
    code: &'static str,
    message: String,
    detail: Option<String>,
}

impl AppError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            detail: None,
        }
    }

    pub(crate) fn with_detail(
        code: &'static str,
        message: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            detail: Some(detail.into()),
        }
    }
}

#[derive(Debug, Serialize)]
struct HealthCheckResult {
    ok: bool,
    version: String,
    platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ThemeId {
    ThemeClaude,
    ThemeAnimal,
    ThemeGlass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum DeepSeekModel {
    DeepseekChat,
    DeepseekReasoner,
}

impl DeepSeekModel {
    fn as_str(&self) -> &'static str {
        match self {
            Self::DeepseekChat => "deepseek-chat",
            Self::DeepseekReasoner => "deepseek-reasoner",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDeepSeekConfig {
    api_key: Option<String>,
    base_url: String,
    model: DeepSeekModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAzureConfig {
    key: Option<String>,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredAppConfig {
    theme: ThemeId,
    deepseek: StoredDeepSeekConfig,
    azure: StoredAzureConfig,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDeepSeekConfig {
    api_key_configured: bool,
    base_url: String,
    model: DeepSeekModel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAzureConfig {
    key_configured: bool,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Serialize)]
struct PublicAppConfig {
    theme: ThemeId,
    deepseek: PublicDeepSeekConfig,
    azure: PublicAzureConfig,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDeepSeekConfigInput {
    #[serde(default)]
    api_key: Option<String>,
    base_url: String,
    model: DeepSeekModel,
}

#[derive(Debug, Clone, Deserialize)]
struct SaveAzureConfigInput {
    #[serde(default)]
    key: Option<String>,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SaveAppConfigInput {
    theme: ThemeId,
    deepseek: SaveDeepSeekConfigInput,
    azure: SaveAzureConfigInput,
}

impl Default for StoredAppConfig {
    fn default() -> Self {
        Self {
            theme: ThemeId::ThemeClaude,
            deepseek: StoredDeepSeekConfig {
                api_key: None,
                base_url: "https://api.deepseek.com".to_string(),
                model: DeepSeekModel::DeepseekChat,
            },
            azure: StoredAzureConfig {
                key: None,
                region: String::new(),
                language: "en-US".to_string(),
            },
        }
    }
}

impl From<StoredAppConfig> for PublicAppConfig {
    fn from(value: StoredAppConfig) -> Self {
        Self {
            theme: value.theme,
            deepseek: PublicDeepSeekConfig {
                api_key_configured: value.deepseek.api_key.is_some(),
                base_url: value.deepseek.base_url,
                model: value.deepseek.model,
            },
            azure: PublicAzureConfig {
                key_configured: value.azure.key.is_some(),
                region: value.azure.region,
                language: value.azure.language,
            },
        }
    }
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
fn get_app_config(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    read_config(&app).map(PublicAppConfig::from)
}

#[tauri::command]
fn save_app_config(app: AppHandle, input: SaveAppConfigInput) -> Result<PublicAppConfig, AppError> {
    validate_config_input(&input)?;

    let mut current = read_config(&app)?;
    current.theme = input.theme;
    current.deepseek.base_url = input.deepseek.base_url.trim().to_string();
    current.deepseek.model = input.deepseek.model;
    current.azure.region = input.azure.region.trim().to_string();
    current.azure.language = input.azure.language.trim().to_string();

    if let Some(api_key) = normalize_optional_secret(input.deepseek.api_key) {
        current.deepseek.api_key = Some(api_key);
    }

    if let Some(key) = normalize_optional_secret(input.azure.key) {
        current.azure.key = Some(key);
    }

    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
fn clear_deepseek_key(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    let mut current = read_config(&app)?;
    current.deepseek.api_key = None;
    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
fn clear_azure_key(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    let mut current = read_config(&app)?;
    current.azure.key = None;
    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
fn validate_azure_config(app: AppHandle) -> Result<grading::ConfigValidationResult, AppError> {
    let config = read_config(&app)?;
    let key_configured = config
        .azure
        .key
        .as_ref()
        .is_some_and(|key| !key.trim().is_empty());
    let region = config.azure.region.trim();
    let language = config.azure.language.trim();
    let ok = key_configured && !region.is_empty() && !language.is_empty();

    Ok(grading::ConfigValidationResult {
        ok,
        api_key_configured: key_configured,
        base_url: region.to_string(),
        model: language.to_string(),
        message: if ok {
            "Azure 配置可用。".to_string()
        } else if !key_configured {
            "请先在设置页配置 Azure Key。".to_string()
        } else if region.is_empty() {
            "Azure region 不能为空。".to_string()
        } else {
            "Azure language 不能为空。".to_string()
        },
    })
}

#[tauri::command]
fn validate_deepseek_config(app: AppHandle) -> Result<grading::ConfigValidationResult, AppError> {
    let config = read_config(&app)?;
    Ok(grading::validate_deepseek_config(&config.deepseek))
}

#[tauri::command]
async fn grade_speaking(
    app: AppHandle,
    request: grading::GradeRequest,
) -> Result<grading::GradeResult, AppError> {
    let config = read_config(&app)?;
    grading::grade_speaking(&config.deepseek, request).await
}

fn validate_config_input(input: &SaveAppConfigInput) -> Result<(), AppError> {
    if input.deepseek.base_url.trim().is_empty() {
        return Err(AppError::new(
            "CONFIG_INVALID",
            "DeepSeek Base URL 不能为空。",
        ));
    }

    if input.azure.language.trim().is_empty() {
        return Err(AppError::new("CONFIG_INVALID", "Azure language 不能为空。"));
    }

    Ok(())
}

fn normalize_optional_secret(value: Option<String>) -> Option<String> {
    value
        .map(|secret| secret.trim().to_string())
        .filter(|secret| !secret.is_empty())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_config_dir().map_err(|error| {
        AppError::with_detail(
            "CONFIG_PATH_FAILED",
            "无法定位应用配置目录。",
            error.to_string(),
        )
    })?;

    Ok(dir.join("config.json"))
}

fn read_config(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let path = config_path(app)?;

    if !path.exists() {
        return Ok(StoredAppConfig::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| {
        AppError::with_detail("CONFIG_READ_FAILED", "读取配置失败。", error.to_string())
    })?;

    serde_json::from_str(&raw).map_err(|error| {
        AppError::with_detail(
            "CONFIG_PARSE_FAILED",
            "配置文件格式错误。",
            error.to_string(),
        )
    })
}

fn write_config(app: &AppHandle, config: &StoredAppConfig) -> Result<(), AppError> {
    let path = config_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| AppError::new("CONFIG_PATH_FAILED", "无法定位应用配置目录。"))?;

    fs::create_dir_all(dir).map_err(|error| {
        AppError::with_detail(
            "CONFIG_WRITE_FAILED",
            "创建配置目录失败。",
            error.to_string(),
        )
    })?;

    let raw = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::with_detail(
            "CONFIG_SERIALIZE_FAILED",
            "序列化配置失败。",
            error.to_string(),
        )
    })?;

    fs::write(path, raw).map_err(|error| {
        AppError::with_detail("CONFIG_WRITE_FAILED", "保存配置失败。", error.to_string())
    })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            health_check,
            get_app_config,
            save_app_config,
            clear_deepseek_key,
            clear_azure_key,
            validate_azure_config,
            validate_deepseek_config,
            grade_speaking,
            media::select_media_file,
            media::get_media_metadata,
            media::transcode_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_save_config_from_frontend_payload() {
        let input: SaveAppConfigInput = serde_json::from_value(serde_json::json!({
            "theme": "theme-animal",
            "deepseek": {
                "apiKey": "sk-test",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-chat"
            },
            "azure": {
                "key": "",
                "region": "eastasia",
                "language": "en-US"
            }
        }))
        .expect("frontend save payload should deserialize");

        assert_eq!(input.deepseek.api_key.as_deref(), Some("sk-test"));
        assert_eq!(input.deepseek.base_url, "https://api.deepseek.com");
        assert_eq!(input.deepseek.model.as_str(), "deepseek-chat");
    }
}
