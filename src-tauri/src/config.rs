use crate::constants::{TEACHER_CASE_SIMILARITY_THRESHOLD, ZHIPU_EMBEDDING_DIMENSIONS};
use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) enum ThemeId {
    #[serde(rename = "theme-claude")]
    Claude,
    #[serde(rename = "theme-animal")]
    Animal,
    #[serde(rename = "theme-glass")]
    Glass,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DeepSeekModel {
    DeepseekV4Flash,
    DeepseekV4Pro,
    DeepseekChat,
    DeepseekReasoner,
}

impl DeepSeekModel {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::DeepseekV4Flash => "deepseek-v4-flash",
            Self::DeepseekV4Pro => "deepseek-v4-pro",
            Self::DeepseekChat => "deepseek-chat",
            Self::DeepseekReasoner => "deepseek-reasoner",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FontPreference {
    System,
    Serif,
    Space,
    Mono,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FontSizePreference {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredDeepSeekConfig {
    pub(crate) api_key: Option<String>,
    pub(crate) base_url: String,
    pub(crate) model: DeepSeekModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredZhipuConfig {
    pub(crate) api_key: Option<String>,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) dimensions: u16,
    #[serde(default = "default_similarity_threshold")]
    pub(crate) similarity_threshold: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredAzureConfig {
    pub(crate) key: Option<String>,
    pub(crate) region: String,
    pub(crate) language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredTypographyConfig {
    font: FontPreference,
    font_size: FontSizePreference,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredAppConfig {
    theme: ThemeId,
    #[serde(default = "default_typography_config")]
    typography: StoredTypographyConfig,
    pub(crate) deepseek: StoredDeepSeekConfig,
    #[serde(default = "default_zhipu_config")]
    pub(crate) zhipu: StoredZhipuConfig,
    pub(crate) azure: StoredAzureConfig,
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
struct PublicZhipuConfig {
    api_key_configured: bool,
    base_url: String,
    model: String,
    dimensions: u16,
    similarity_threshold: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAzureConfig {
    key_configured: bool,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicTypographyConfig {
    font: FontPreference,
    font_size: FontSizePreference,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct PublicAppConfig {
    theme: ThemeId,
    typography: PublicTypographyConfig,
    deepseek: PublicDeepSeekConfig,
    zhipu: PublicZhipuConfig,
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
#[serde(rename_all = "camelCase")]
struct SaveZhipuConfigInput {
    #[serde(default)]
    api_key: Option<String>,
    base_url: String,
    model: String,
    dimensions: u16,
    #[serde(default)]
    similarity_threshold: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct SaveAzureConfigInput {
    #[serde(default)]
    key: Option<String>,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTypographyConfigInput {
    font: FontPreference,
    font_size: FontSizePreference,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SaveAppConfigInput {
    theme: ThemeId,
    typography: SaveTypographyConfigInput,
    deepseek: SaveDeepSeekConfigInput,
    zhipu: SaveZhipuConfigInput,
    azure: SaveAzureConfigInput,
}

#[tauri::command]
pub(crate) fn get_app_config(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    read_config(&app).map(PublicAppConfig::from)
}

#[tauri::command]
pub(crate) fn save_app_config(
    app: AppHandle,
    input: SaveAppConfigInput,
) -> Result<PublicAppConfig, AppError> {
    validate_config_input(&input)?;

    let mut current = read_config(&app)?;
    current.theme = input.theme;
    current.typography.font = input.typography.font;
    current.typography.font_size = input.typography.font_size;
    current.deepseek.base_url = input.deepseek.base_url.trim().to_string();
    current.deepseek.model = input.deepseek.model;
    current.zhipu.base_url = input.zhipu.base_url.trim().to_string();
    current.zhipu.model = input.zhipu.model.trim().to_string();
    current.zhipu.dimensions = ZHIPU_EMBEDDING_DIMENSIONS;
    current.zhipu.similarity_threshold = input
        .zhipu
        .similarity_threshold
        .unwrap_or(current.zhipu.similarity_threshold);
    current.azure.region = input.azure.region.trim().to_string();
    current.azure.language = input.azure.language.trim().to_string();

    if let Some(api_key) = normalize_optional_secret(input.deepseek.api_key) {
        current.deepseek.api_key = Some(api_key);
    }

    if let Some(api_key) = normalize_optional_secret(input.zhipu.api_key) {
        current.zhipu.api_key = Some(api_key);
    }

    if let Some(key) = normalize_optional_secret(input.azure.key) {
        current.azure.key = Some(key);
    }

    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
pub(crate) fn clear_deepseek_key(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    let mut current = read_config(&app)?;
    current.deepseek.api_key = None;
    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
pub(crate) fn clear_zhipu_key(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    let mut current = read_config(&app)?;
    current.zhipu.api_key = None;
    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

#[tauri::command]
pub(crate) fn clear_azure_key(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    let mut current = read_config(&app)?;
    current.azure.key = None;
    write_config(&app, &current)?;
    Ok(PublicAppConfig::from(current))
}

pub(crate) fn read_config(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let path = config_path(app)?;

    if !path.exists() {
        return Ok(StoredAppConfig::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| {
        AppError::with_detail("CONFIG_READ_FAILED", "读取配置失败。", error.to_string())
    })?;

    let mut config: StoredAppConfig = serde_json::from_str(&raw).map_err(|error| {
        AppError::with_detail(
            "CONFIG_PARSE_FAILED",
            "配置文件格式错误。",
            error.to_string(),
        )
    })?;
    config.zhipu.dimensions = ZHIPU_EMBEDDING_DIMENSIONS;
    config.zhipu.similarity_threshold =
        normalize_similarity_threshold(config.zhipu.similarity_threshold);
    Ok(config)
}

fn default_similarity_threshold() -> f64 {
    TEACHER_CASE_SIMILARITY_THRESHOLD
}

fn normalize_similarity_threshold(value: f64) -> f64 {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        value
    } else {
        TEACHER_CASE_SIMILARITY_THRESHOLD
    }
}

fn default_typography_config() -> StoredTypographyConfig {
    StoredTypographyConfig {
        font: FontPreference::System,
        font_size: FontSizePreference::Medium,
    }
}

fn default_zhipu_config() -> StoredZhipuConfig {
    StoredZhipuConfig {
        api_key: None,
        base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
        model: "embedding-3".to_string(),
        dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
        similarity_threshold: TEACHER_CASE_SIMILARITY_THRESHOLD,
    }
}

impl Default for StoredAppConfig {
    fn default() -> Self {
        Self {
            theme: ThemeId::Claude,
            typography: default_typography_config(),
            deepseek: StoredDeepSeekConfig {
                api_key: None,
                base_url: "https://api.deepseek.com".to_string(),
                model: DeepSeekModel::DeepseekV4Flash,
            },
            zhipu: default_zhipu_config(),
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
            typography: PublicTypographyConfig {
                font: value.typography.font,
                font_size: value.typography.font_size,
            },
            deepseek: PublicDeepSeekConfig {
                api_key_configured: value.deepseek.api_key.is_some(),
                base_url: value.deepseek.base_url,
                model: value.deepseek.model,
            },
            zhipu: PublicZhipuConfig {
                api_key_configured: value.zhipu.api_key.is_some(),
                base_url: value.zhipu.base_url,
                model: value.zhipu.model,
                dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
                similarity_threshold: normalize_similarity_threshold(
                    value.zhipu.similarity_threshold,
                ),
            },
            azure: PublicAzureConfig {
                key_configured: value.azure.key.is_some(),
                region: value.azure.region,
                language: value.azure.language,
            },
        }
    }
}

fn validate_config_input(input: &SaveAppConfigInput) -> Result<(), AppError> {
    if input.deepseek.base_url.trim().is_empty() {
        return Err(AppError::new(
            "CONFIG_INVALID",
            "DeepSeek Base URL 不能为空。",
        ));
    }

    if input.zhipu.base_url.trim().is_empty() {
        return Err(AppError::new("CONFIG_INVALID", "智谱 Base URL 不能为空。"));
    }

    if input.zhipu.model.trim().is_empty() {
        return Err(AppError::new(
            "CONFIG_INVALID",
            "智谱 Embedding 模型不能为空。",
        ));
    }

    if input.zhipu.dimensions != ZHIPU_EMBEDDING_DIMENSIONS {
        return Err(AppError::new(
            "CONFIG_INVALID",
            format!("智谱 Embedding 维度必须是 {ZHIPU_EMBEDDING_DIMENSIONS}。"),
        ));
    }

    if let Some(similarity_threshold) = input.zhipu.similarity_threshold {
        if !similarity_threshold.is_finite() || !(0.0..=1.0).contains(&similarity_threshold) {
            return Err(AppError::new(
                "CONFIG_INVALID",
                "教师案例 RAG 相似度阈值必须在 0.0-1.0 之间。",
            ));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_save_config_from_frontend_payload() {
        let input: SaveAppConfigInput = serde_json::from_value(serde_json::json!({
            "theme": "theme-animal",
            "typography": {
                "font": "serif",
                "fontSize": "large"
            },
            "deepseek": {
                "apiKey": "sk-test",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "zhipu": {
                "apiKey": "zhipu-test",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "model": "embedding-3",
                "dimensions": ZHIPU_EMBEDDING_DIMENSIONS,
                "similarityThreshold": 0.62
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
        assert_eq!(input.deepseek.model.as_str(), "deepseek-v4-flash");
        assert_eq!(input.zhipu.api_key.as_deref(), Some("zhipu-test"));
        assert_eq!(input.zhipu.base_url, "https://open.bigmodel.cn/api/paas/v4");
        assert_eq!(input.zhipu.model, "embedding-3");
        assert_eq!(input.zhipu.dimensions, ZHIPU_EMBEDDING_DIMENSIONS);
        assert_eq!(input.zhipu.similarity_threshold, Some(0.62));
        assert!(matches!(input.typography.font, FontPreference::Serif));
        assert!(matches!(
            input.typography.font_size,
            FontSizePreference::Large
        ));
    }

    #[test]
    fn deserializes_legacy_deepseek_model_from_existing_config() {
        let model: DeepSeekModel =
            serde_json::from_value(serde_json::json!("deepseek-chat")).expect("legacy model");

        assert_eq!(model.as_str(), "deepseek-chat");
    }

    #[test]
    fn reads_existing_config_without_zhipu_section() {
        let config: StoredAppConfig = serde_json::from_value(serde_json::json!({
            "theme": "theme-claude",
            "typography": {
                "font": "system",
                "font_size": "medium"
            },
            "deepseek": {
                "apiKey": null,
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "azure": {
                "key": null,
                "region": "",
                "language": "en-US"
            }
        }))
        .expect("legacy config should deserialize");

        assert_eq!(
            config.zhipu.base_url,
            "https://open.bigmodel.cn/api/paas/v4"
        );
        assert_eq!(config.zhipu.model, "embedding-3");
        assert_eq!(config.zhipu.dimensions, ZHIPU_EMBEDDING_DIMENSIONS);
        assert_eq!(
            config.zhipu.similarity_threshold,
            TEACHER_CASE_SIMILARITY_THRESHOLD
        );
    }

    #[test]
    fn defaults_missing_similarity_threshold_in_legacy_zhipu_config() {
        let config: StoredAppConfig = serde_json::from_value(serde_json::json!({
            "theme": "theme-claude",
            "typography": {
                "font": "system",
                "font_size": "medium"
            },
            "deepseek": {
                "apiKey": null,
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "zhipu": {
                "apiKey": null,
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "model": "embedding-3",
                "dimensions": ZHIPU_EMBEDDING_DIMENSIONS
            },
            "azure": {
                "key": null,
                "region": "",
                "language": "en-US"
            }
        }))
        .expect("legacy zhipu config should deserialize");

        assert_eq!(
            config.zhipu.similarity_threshold,
            TEACHER_CASE_SIMILARITY_THRESHOLD
        );
    }

    #[test]
    fn rejects_similarity_threshold_outside_unit_range() {
        let input: SaveAppConfigInput = serde_json::from_value(serde_json::json!({
            "theme": "theme-claude",
            "typography": {
                "font": "system",
                "fontSize": "medium"
            },
            "deepseek": {
                "apiKey": "",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "zhipu": {
                "apiKey": "",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "model": "embedding-3",
                "dimensions": ZHIPU_EMBEDDING_DIMENSIONS,
                "similarityThreshold": 1.01
            },
            "azure": {
                "key": "",
                "region": "",
                "language": "en-US"
            }
        }))
        .expect("config input");

        let error = validate_config_input(&input).expect_err("threshold should be rejected");
        assert_eq!(error.code, "CONFIG_INVALID");
    }

    #[test]
    fn rejects_non_current_zhipu_embedding_dimensions() {
        let input: SaveAppConfigInput = serde_json::from_value(serde_json::json!({
            "theme": "theme-claude",
            "typography": {
                "font": "system",
                "fontSize": "medium"
            },
            "deepseek": {
                "apiKey": "",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "zhipu": {
                "apiKey": "",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "model": "embedding-3",
                "dimensions": 2048,
                "similarityThreshold": TEACHER_CASE_SIMILARITY_THRESHOLD
            },
            "azure": {
                "key": "",
                "region": "",
                "language": "en-US"
            }
        }))
        .expect("config input");

        let error = validate_config_input(&input).expect_err("dimensions should be rejected");
        assert_eq!(error.code, "CONFIG_INVALID");
        assert_eq!(
            error.message,
            format!("智谱 Embedding 维度必须是 {ZHIPU_EMBEDDING_DIMENSIONS}。")
        );
    }
}
