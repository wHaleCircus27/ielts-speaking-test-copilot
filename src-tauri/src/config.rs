use crate::constants::{TEACHER_CASE_SIMILARITY_THRESHOLD, ZHIPU_EMBEDDING_DIMENSIONS};
use crate::credentials::{
    clear_credential_verified_with_backend, read_credential_with_backend,
    replace_credential_verified_with_backend, rollback_credential_with_backend, CredentialAccount,
    CredentialBackend, CredentialRollback, SystemCredentialBackend,
};
use crate::endpoints::{normalize_azure_region, normalize_cloud_base_url, NormalizedCloudEndpoint};
use crate::errors::AppError;
use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CONFIG_SCHEMA_VERSION: u8 = 2;
const CLOUD_DISCLOSURE_VERSION: u16 = 1;
const CONFIG_QUARANTINE_FILE_NAME: &str = ".config-transaction-quarantine";
const CONFIG_QUARANTINE_CONTENT: &[u8] = b"version=1\n";

#[derive(Default)]
pub(crate) struct ConfigTransactionLock(Mutex<()>);

struct ConfigQuarantineToken {
    marker_path: PathBuf,
    existed_before_transaction: bool,
}

#[derive(Clone, Copy)]
enum PreexistingQuarantinePolicy {
    RepairWithFullSave,
    Reject,
}

trait ConfigQuarantineBackend {
    fn begin(&mut self, config_path: &Path) -> Result<ConfigQuarantineToken, AppError>;
    fn clear(&mut self, token: &ConfigQuarantineToken) -> Result<(), AppError>;
    fn is_quarantined(&mut self, config_path: &Path) -> Result<bool, AppError>;
}

struct FileConfigQuarantineBackend<F> {
    sync_directory_callback: F,
}

impl<F> ConfigQuarantineBackend for FileConfigQuarantineBackend<F>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    fn begin(&mut self, config_path: &Path) -> Result<ConfigQuarantineToken, AppError> {
        begin_file_config_quarantine(config_path, &mut self.sync_directory_callback)
    }

    fn clear(&mut self, token: &ConfigQuarantineToken) -> Result<(), AppError> {
        clear_file_config_quarantine(token, &mut self.sync_directory_callback)
    }

    fn is_quarantined(&mut self, config_path: &Path) -> Result<bool, AppError> {
        file_config_quarantine_exists(config_path)
    }
}

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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CredentialStatus {
    Configured,
    BindingMismatch,
    #[default]
    Missing,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredDeepSeekConfig {
    #[serde(default, serialize_with = "serialize_optional_secret_as_null")]
    pub(crate) api_key: Option<String>,
    #[serde(default)]
    pub(crate) enabled: bool,
    pub(crate) base_url: String,
    pub(crate) model: DeepSeekModel,
    #[serde(default)]
    pub(crate) allow_insecure_localhost: bool,
    #[serde(skip, default)]
    pub(crate) credential_status: CredentialStatus,
    #[serde(skip, default)]
    pub(crate) disclosure_accepted_version: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredZhipuConfig {
    #[serde(default, serialize_with = "serialize_optional_secret_as_null")]
    pub(crate) api_key: Option<String>,
    #[serde(default)]
    pub(crate) enabled: bool,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) dimensions: u16,
    #[serde(default)]
    pub(crate) allow_insecure_localhost: bool,
    #[serde(default = "default_similarity_threshold")]
    pub(crate) similarity_threshold: f64,
    #[serde(skip, default)]
    pub(crate) credential_status: CredentialStatus,
    #[serde(skip, default)]
    pub(crate) disclosure_accepted_version: Option<u16>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAzureConfig {
    #[serde(default, serialize_with = "serialize_optional_secret_as_null")]
    pub(crate) key: Option<String>,
    #[serde(default)]
    pub(crate) enabled: bool,
    pub(crate) region: String,
    pub(crate) language: String,
    #[serde(skip, default)]
    pub(crate) credential_status: CredentialStatus,
    #[serde(skip, default)]
    pub(crate) disclosure_accepted_version: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTypographyConfig {
    font: FontPreference,
    #[serde(alias = "font_size")]
    font_size: FontSizePreference,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCloudDisclosure {
    #[serde(default)]
    accepted_version: Option<u16>,
    #[serde(default)]
    migration_notice_pending: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAppConfig {
    #[serde(default = "legacy_schema_version")]
    schema_version: u8,
    theme: ThemeId,
    #[serde(default = "default_typography_config")]
    typography: StoredTypographyConfig,
    pub(crate) deepseek: StoredDeepSeekConfig,
    #[serde(default = "default_zhipu_config")]
    pub(crate) zhipu: StoredZhipuConfig,
    pub(crate) azure: StoredAzureConfig,
    #[serde(default)]
    disclosure: StoredCloudDisclosure,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDeepSeekConfig {
    api_key_configured: bool,
    credential_status: CredentialStatus,
    enabled: bool,
    base_url: String,
    model: DeepSeekModel,
    allow_insecure_localhost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicZhipuConfig {
    api_key_configured: bool,
    credential_status: CredentialStatus,
    enabled: bool,
    base_url: String,
    model: String,
    dimensions: u16,
    similarity_threshold: f64,
    allow_insecure_localhost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicAzureConfig {
    key_configured: bool,
    credential_status: CredentialStatus,
    enabled: bool,
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
#[serde(rename_all = "camelCase")]
struct PublicCloudDisclosure {
    latest_version: u16,
    accepted_version: Option<u16>,
    notice_required: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicAppConfig {
    schema_version: u8,
    theme: ThemeId,
    typography: PublicTypographyConfig,
    deepseek: PublicDeepSeekConfig,
    zhipu: PublicZhipuConfig,
    azure: PublicAzureConfig,
    disclosure: PublicCloudDisclosure,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDeepSeekConfigInput {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    enabled: bool,
    base_url: String,
    model: DeepSeekModel,
    #[serde(default)]
    allow_insecure_localhost: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveZhipuConfigInput {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    enabled: bool,
    base_url: String,
    model: String,
    dimensions: u16,
    #[serde(default)]
    similarity_threshold: Option<f64>,
    #[serde(default)]
    allow_insecure_localhost: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAzureConfigInput {
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    enabled: bool,
    region: String,
    language: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTypographyConfigInput {
    font: FontPreference,
    font_size: FontSizePreference,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveAppConfigInput {
    theme: ThemeId,
    typography: SaveTypographyConfigInput,
    deepseek: SaveDeepSeekConfigInput,
    zhipu: SaveZhipuConfigInput,
    azure: SaveAzureConfigInput,
}

struct NormalizedConfigInput {
    deepseek_endpoint: NormalizedCloudEndpoint,
    zhipu_endpoint: NormalizedCloudEndpoint,
    azure_region: String,
}

#[tauri::command]
pub(crate) fn get_app_config(app: AppHandle) -> Result<PublicAppConfig, AppError> {
    read_config(&app).map(PublicAppConfig::from)
}

#[tauri::command]
pub(crate) fn save_app_config(
    app: AppHandle,
    config_transaction_lock: tauri::State<'_, ConfigTransactionLock>,
    input: SaveAppConfigInput,
) -> Result<PublicAppConfig, AppError> {
    with_config_transaction_lock(&config_transaction_lock, || {
        let path = config_path(&app)?;
        let mut credential_backend = SystemCredentialBackend;
        save_app_config_at_path_with_backend(
            &path,
            input,
            &mut credential_backend,
            write_config_at_path,
        )
        .map(PublicAppConfig::from)
    })
}

fn save_app_config_at_path_with_backend<B, F>(
    path: &Path,
    input: SaveAppConfigInput,
    credential_backend: &mut B,
    write_config_callback: F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let mut quarantine_backend = file_config_quarantine_backend();
    save_app_config_at_path_with_backends(
        path,
        input,
        credential_backend,
        write_config_callback,
        &mut quarantine_backend,
    )
}

fn save_app_config_at_path_with_backends<B, F, Q>(
    path: &Path,
    input: SaveAppConfigInput,
    credential_backend: &mut B,
    write_config_callback: F,
    quarantine_backend: &mut Q,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    Q: ConfigQuarantineBackend,
{
    execute_config_transaction_with_quarantine(
        path,
        quarantine_backend,
        PreexistingQuarantinePolicy::RepairWithFullSave,
        || {
            save_app_config_at_path_in_transaction_with_backend(
                path,
                input,
                credential_backend,
                write_config_callback,
            )
        },
    )
}

fn save_app_config_at_path_in_transaction_with_backend<B, F>(
    path: &Path,
    input: SaveAppConfigInput,
    credential_backend: &mut B,
    mut write_config_callback: F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let normalized_input = normalize_config_input(&input)?;

    let mut current = read_config_at_path_in_transaction_with_backend(
        path,
        credential_backend,
        &mut write_config_callback,
    )?;
    if (input.deepseek.enabled || input.zhipu.enabled || input.azure.enabled)
        && current.disclosure.accepted_version != Some(CLOUD_DISCLOSURE_VERSION)
    {
        return Err(AppError::new(
            "CLOUD_DISCLOSURE_REQUIRED",
            "启用云服务前必须接受当前数据流说明。",
        ));
    }

    let new_deepseek_key = normalize_optional_secret(input.deepseek.api_key);
    let new_zhipu_key = normalize_optional_secret(input.zhipu.api_key);
    let new_azure_key = normalize_optional_secret(input.azure.key);
    let existing_deepseek_key_matches = current.deepseek.api_key.is_some()
        && normalize_cloud_base_url(
            &current.deepseek.base_url,
            current.deepseek.allow_insecure_localhost,
            "DeepSeek",
        )
        .is_ok_and(|endpoint| endpoint.binding == normalized_input.deepseek_endpoint.binding);
    let existing_zhipu_key_matches = current.zhipu.api_key.is_some()
        && normalize_cloud_base_url(
            &current.zhipu.base_url,
            current.zhipu.allow_insecure_localhost,
            "智谱",
        )
        .is_ok_and(|endpoint| endpoint.binding == normalized_input.zhipu_endpoint.binding);
    let existing_azure_key_matches = current.azure.key.is_some()
        && normalize_azure_region(&current.azure.region)
            .is_ok_and(|region| region == normalized_input.azure_region);
    let has_deepseek_credential = current.deepseek.credential_status != CredentialStatus::Missing;
    let has_zhipu_credential = current.zhipu.credential_status != CredentialStatus::Missing;
    let has_azure_credential = current.azure.credential_status != CredentialStatus::Missing;

    for (enabled, new_key_configured, existing_key_matches, service_name) in [
        (
            input.deepseek.enabled,
            new_deepseek_key.is_some(),
            existing_deepseek_key_matches,
            "DeepSeek",
        ),
        (
            input.zhipu.enabled,
            new_zhipu_key.is_some(),
            existing_zhipu_key_matches,
            "智谱",
        ),
        (
            input.azure.enabled,
            new_azure_key.is_some(),
            existing_azure_key_matches,
            "Azure",
        ),
    ] {
        if enabled && !new_key_configured && !existing_key_matches {
            return Err(AppError::new(
                "CREDENTIAL_REQUIRED",
                format!("启用 {service_name} 前需要输入与当前端点绑定的 Key。"),
            ));
        }
    }

    current.theme = input.theme;
    current.typography.font = input.typography.font;
    current.typography.font_size = input.typography.font_size;
    current.schema_version = CONFIG_SCHEMA_VERSION;
    current.deepseek.enabled = input.deepseek.enabled;
    current.deepseek.base_url = normalized_input.deepseek_endpoint.base_url.clone();
    current.deepseek.model = input.deepseek.model;
    current.deepseek.allow_insecure_localhost = input.deepseek.allow_insecure_localhost;
    current.zhipu.enabled = input.zhipu.enabled;
    current.zhipu.base_url = normalized_input.zhipu_endpoint.base_url.clone();
    current.zhipu.model = input.zhipu.model.trim().to_string();
    current.zhipu.dimensions = ZHIPU_EMBEDDING_DIMENSIONS;
    current.zhipu.allow_insecure_localhost = input.zhipu.allow_insecure_localhost;
    current.zhipu.similarity_threshold = input
        .zhipu
        .similarity_threshold
        .unwrap_or(current.zhipu.similarity_threshold);
    current.azure.enabled = input.azure.enabled;
    current.azure.region = normalized_input.azure_region.clone();
    current.azure.language = input.azure.language.trim().to_string();

    let mut credential_rollbacks = Vec::new();
    if let Some(api_key) = new_deepseek_key {
        stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::DeepSeek,
            &api_key,
            &normalized_input.deepseek_endpoint.binding,
        )?;
    } else if has_deepseek_credential && !existing_deepseek_key_matches {
        stage_credential_clear_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::DeepSeek,
        )?;
    }

    if let Some(api_key) = new_zhipu_key {
        if let Err(error) = stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Zhipu,
            &api_key,
            &normalized_input.zhipu_endpoint.binding,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
    } else if has_zhipu_credential && !existing_zhipu_key_matches {
        if let Err(error) = stage_credential_clear_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Zhipu,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
    }

    if let Some(key) = new_azure_key {
        if let Err(error) = stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Azure,
            &key,
            &normalized_input.azure_region,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
    } else if has_azure_credential && !existing_azure_key_matches {
        if let Err(error) = stage_credential_clear_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Azure,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
    }

    current.deepseek.api_key = None;
    current.zhipu.api_key = None;
    current.azure.key = None;
    if let Err(error) = write_config_callback(path, &current) {
        if config_write_failure_preserved_previous(&error) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
        }
        return Err(error);
    }

    read_config_at_path_in_transaction_with_backend(
        path,
        credential_backend,
        &mut write_config_callback,
    )
}

#[tauri::command]
pub(crate) fn clear_deepseek_key(
    app: AppHandle,
    config_transaction_lock: tauri::State<'_, ConfigTransactionLock>,
) -> Result<PublicAppConfig, AppError> {
    with_config_transaction_lock(&config_transaction_lock, || {
        clear_cloud_credential(&app, CredentialAccount::DeepSeek).map(PublicAppConfig::from)
    })
}

#[tauri::command]
pub(crate) fn clear_zhipu_key(
    app: AppHandle,
    config_transaction_lock: tauri::State<'_, ConfigTransactionLock>,
) -> Result<PublicAppConfig, AppError> {
    with_config_transaction_lock(&config_transaction_lock, || {
        clear_cloud_credential(&app, CredentialAccount::Zhipu).map(PublicAppConfig::from)
    })
}

#[tauri::command]
pub(crate) fn clear_azure_key(
    app: AppHandle,
    config_transaction_lock: tauri::State<'_, ConfigTransactionLock>,
) -> Result<PublicAppConfig, AppError> {
    with_config_transaction_lock(&config_transaction_lock, || {
        clear_cloud_credential(&app, CredentialAccount::Azure).map(PublicAppConfig::from)
    })
}

fn clear_cloud_credential(
    app: &AppHandle,
    account: CredentialAccount,
) -> Result<StoredAppConfig, AppError> {
    let path = config_path(app)?;
    let mut credential_backend = SystemCredentialBackend;
    clear_cloud_credential_at_path_with_backend(
        &path,
        account,
        &mut credential_backend,
        write_config_at_path,
    )
}

fn clear_cloud_credential_at_path_with_backend<B, F>(
    path: &Path,
    account: CredentialAccount,
    credential_backend: &mut B,
    write_config_callback: F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let mut quarantine_backend = file_config_quarantine_backend();
    clear_cloud_credential_at_path_with_backends(
        path,
        account,
        credential_backend,
        write_config_callback,
        &mut quarantine_backend,
    )
}

fn clear_cloud_credential_at_path_with_backends<B, F, Q>(
    path: &Path,
    account: CredentialAccount,
    credential_backend: &mut B,
    write_config_callback: F,
    quarantine_backend: &mut Q,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    Q: ConfigQuarantineBackend,
{
    execute_config_transaction_with_quarantine(
        path,
        quarantine_backend,
        PreexistingQuarantinePolicy::Reject,
        || {
            clear_cloud_credential_at_path_in_transaction_with_backend(
                path,
                account,
                credential_backend,
                write_config_callback,
            )
        },
    )
}

fn clear_cloud_credential_at_path_in_transaction_with_backend<B, F>(
    path: &Path,
    account: CredentialAccount,
    credential_backend: &mut B,
    mut write_config_callback: F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let mut current = read_config_at_path_in_transaction_with_backend(
        path,
        credential_backend,
        &mut write_config_callback,
    )?;
    let credential_rollback = clear_credential_verified_with_backend(credential_backend, account)?;

    match account {
        CredentialAccount::DeepSeek => {
            current.deepseek.api_key = None;
            current.deepseek.enabled = false;
        }
        CredentialAccount::Zhipu => {
            current.zhipu.api_key = None;
            current.zhipu.enabled = false;
        }
        CredentialAccount::Azure => {
            current.azure.key = None;
            current.azure.enabled = false;
        }
    }

    if let Err(error) = write_config_callback(path, &current) {
        if config_write_failure_preserved_previous(&error) {
            rollback_credential_with_backend(credential_backend, credential_rollback)?;
        }
        return Err(error);
    }

    read_config_at_path_in_transaction_with_backend(
        path,
        credential_backend,
        &mut write_config_callback,
    )
}

#[tauri::command]
pub(crate) fn accept_cloud_disclosure(
    app: AppHandle,
    config_transaction_lock: tauri::State<'_, ConfigTransactionLock>,
    version: u16,
) -> Result<PublicAppConfig, AppError> {
    if version != CLOUD_DISCLOSURE_VERSION {
        return Err(AppError::new(
            "CLOUD_DISCLOSURE_VERSION_INVALID",
            "数据流说明版本无效，请刷新设置后重试。",
        ));
    }

    with_config_transaction_lock(&config_transaction_lock, || {
        let path = config_path(&app)?;
        let mut credential_backend = SystemCredentialBackend;
        let mut quarantine_backend = file_config_quarantine_backend();
        accept_cloud_disclosure_at_path_with_backends(
            &path,
            &mut credential_backend,
            write_config_at_path,
            &mut quarantine_backend,
        )
        .map(PublicAppConfig::from)
    })
}

fn accept_cloud_disclosure_at_path_with_backends<B, F, Q>(
    path: &Path,
    credential_backend: &mut B,
    mut write_config_callback: F,
    quarantine_backend: &mut Q,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    Q: ConfigQuarantineBackend,
{
    execute_config_transaction_with_quarantine(
        path,
        quarantine_backend,
        PreexistingQuarantinePolicy::Reject,
        || {
            let mut current = read_config_at_path_in_transaction_with_backend(
                path,
                credential_backend,
                &mut write_config_callback,
            )?;
            current.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
            current.disclosure.migration_notice_pending = false;
            write_config_callback(path, &current)?;
            read_config_at_path_in_transaction_with_backend(
                path,
                credential_backend,
                &mut write_config_callback,
            )
        },
    )
}

fn with_config_transaction_lock<T, F>(
    config_transaction_lock: &ConfigTransactionLock,
    transaction: F,
) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    let _transaction_guard = config_transaction_lock.0.lock().map_err(|_| {
        AppError::new(
            "CONFIG_TRANSACTION_LOCK_FAILED",
            "配置事务暂时不可用，云服务配置未更改。",
        )
    })?;
    transaction()
}

fn file_config_quarantine_backend() -> FileConfigQuarantineBackend<fn(&Path) -> io::Result<()>> {
    FileConfigQuarantineBackend {
        sync_directory_callback: sync_directory,
    }
}

fn execute_config_transaction_with_quarantine<T, Q, F>(
    config_path: &Path,
    quarantine_backend: &mut Q,
    preexisting_quarantine_policy: PreexistingQuarantinePolicy,
    transaction: F,
) -> Result<T, AppError>
where
    Q: ConfigQuarantineBackend,
    F: FnOnce() -> Result<T, AppError>,
{
    let quarantine_token = quarantine_backend.begin(config_path)?;
    if quarantine_token.existed_before_transaction
        && matches!(
            preexisting_quarantine_policy,
            PreexistingQuarantinePolicy::Reject
        )
    {
        return Err(config_transaction_quarantined_error());
    }
    match transaction() {
        Ok(value) => {
            quarantine_backend.clear(&quarantine_token)?;
            Ok(value)
        }
        Err(error) => {
            if config_transaction_failure_is_consistent(&error)
                && !quarantine_token.existed_before_transaction
            {
                quarantine_backend.clear(&quarantine_token)?;
            }
            Err(error)
        }
    }
}

fn config_transaction_failure_is_consistent(error: &AppError) -> bool {
    !matches!(
        error.code,
        "CONFIG_ROLLBACK_FAILED" | "CREDENTIAL_ROLLBACK_FAILED"
    )
}

fn begin_file_config_quarantine<F>(
    config_path: &Path,
    sync_directory_callback: &mut F,
) -> Result<ConfigQuarantineToken, AppError>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let directory = config_path
        .parent()
        .ok_or_else(config_quarantine_path_error)?;
    fs::create_dir_all(directory).map_err(|error| {
        AppError::with_detail(
            "CONFIG_QUARANTINE_BEGIN_FAILED",
            "无法建立配置安全隔离，配置未更改。",
            error.to_string(),
        )
    })?;
    set_directory_permissions(directory)?;

    let marker_path = config_quarantine_marker_path(config_path)?;
    let marker_file_existed = match fs::symlink_metadata(&marker_path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(AppError::new(
                "CONFIG_QUARANTINE_PATH_UNSAFE",
                "配置安全隔离文件路径无效，配置未更改。",
            ));
        }
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(AppError::with_detail(
                "CONFIG_QUARANTINE_BEGIN_FAILED",
                "无法检查配置安全隔离状态，配置未更改。",
                error.to_string(),
            ));
        }
    };

    let existed_before_transaction =
        marker_file_existed || process_config_quarantine_exists(&marker_path)?;
    write_config_quarantine_marker(&marker_path, marker_file_existed)?;
    register_process_config_quarantine(&marker_path)?;
    sync_directory_callback(directory).map_err(|error| {
        AppError::with_detail(
            "CONFIG_QUARANTINE_BEGIN_FAILED",
            "无法同步配置安全隔离，配置未更改。",
            error.to_string(),
        )
    })?;

    Ok(ConfigQuarantineToken {
        marker_path,
        existed_before_transaction,
    })
}

fn write_config_quarantine_marker(path: &Path, existing_file: bool) -> Result<(), AppError> {
    let mut options = OpenOptions::new();
    options.write(true).truncate(existing_file);
    if existing_file {
        options.create(false);
    } else {
        options.create_new(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut marker_file = options.open(path).map_err(|error| {
        AppError::with_detail(
            "CONFIG_QUARANTINE_BEGIN_FAILED",
            "无法写入配置安全隔离，配置未更改。",
            error.to_string(),
        )
    })?;
    set_file_permissions(path)?;
    marker_file
        .write_all(CONFIG_QUARANTINE_CONTENT)
        .and_then(|()| marker_file.flush())
        .and_then(|()| marker_file.sync_all())
        .map_err(|error| {
            AppError::with_detail(
                "CONFIG_QUARANTINE_BEGIN_FAILED",
                "无法同步配置安全隔离，配置未更改。",
                error.to_string(),
            )
        })
}

fn clear_file_config_quarantine<F>(
    token: &ConfigQuarantineToken,
    sync_directory_callback: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let directory = token
        .marker_path
        .parent()
        .ok_or_else(config_quarantine_path_error)?;
    if let Err(error) = fs::remove_file(&token.marker_path) {
        return Err(AppError::with_detail(
            "CONFIG_QUARANTINE_CLEAR_FAILED",
            "配置已处理，但安全隔离尚未解除；云请求继续阻断。",
            error.to_string(),
        ));
    }
    if let Err(error) = sync_directory_callback(directory) {
        restore_config_quarantine_after_clear_failure(&token.marker_path, directory);
        return Err(AppError::with_detail(
            "CONFIG_QUARANTINE_CLEAR_FAILED",
            "配置已处理，但安全隔离尚未解除；云请求继续阻断。",
            error.to_string(),
        ));
    }
    unregister_process_config_quarantine(&token.marker_path).map_err(|error| {
        AppError::with_detail(
            "CONFIG_QUARANTINE_CLEAR_FAILED",
            "配置已处理，但安全隔离尚未解除；云请求继续阻断。",
            error.message,
        )
    })?;
    Ok(())
}

fn restore_config_quarantine_after_clear_failure(marker_path: &Path, directory: &Path) {
    let _ = write_config_quarantine_marker(marker_path, marker_path.exists());
    let _ = sync_directory(directory);
}

fn file_config_quarantine_exists(config_path: &Path) -> Result<bool, AppError> {
    let marker_path = config_quarantine_marker_path(config_path)?;
    if process_config_quarantine_exists(&marker_path)? {
        return Ok(true);
    }
    match fs::symlink_metadata(marker_path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(AppError::with_detail(
            "CONFIG_QUARANTINE_CHECK_FAILED",
            "无法验证配置安全隔离状态，云请求已阻断。",
            error.to_string(),
        )),
    }
}

fn process_config_quarantine_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static QUARANTINED_CONFIG_PATHS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    QUARANTINED_CONFIG_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn register_process_config_quarantine(marker_path: &Path) -> Result<(), AppError> {
    process_config_quarantine_paths()
        .lock()
        .map_err(|_| config_quarantine_registry_error())?
        .insert(marker_path.to_path_buf());
    Ok(())
}

fn unregister_process_config_quarantine(marker_path: &Path) -> Result<(), AppError> {
    process_config_quarantine_paths()
        .lock()
        .map_err(|_| config_quarantine_registry_error())?
        .remove(marker_path);
    Ok(())
}

fn process_config_quarantine_exists(marker_path: &Path) -> Result<bool, AppError> {
    process_config_quarantine_paths()
        .lock()
        .map(|paths| paths.contains(marker_path))
        .map_err(|_| config_quarantine_registry_error())
}

fn config_quarantine_registry_error() -> AppError {
    AppError::new(
        "CONFIG_QUARANTINE_CHECK_FAILED",
        "无法验证配置安全隔离状态，云请求已阻断。",
    )
}

fn ensure_config_not_quarantined_at_path_with_backend<Q: ConfigQuarantineBackend>(
    config_path: &Path,
    quarantine_backend: &mut Q,
) -> Result<(), AppError> {
    if quarantine_backend.is_quarantined(config_path)? {
        return Err(config_transaction_quarantined_error());
    }
    Ok(())
}

fn config_transaction_quarantined_error() -> AppError {
    AppError::new(
        "CONFIG_TRANSACTION_QUARANTINED",
        "云服务配置一致性尚未恢复，请在设置中完整重新保存配置。",
    )
}

fn config_quarantine_path_error() -> AppError {
    AppError::new(
        "CONFIG_QUARANTINE_PATH_FAILED",
        "无法定位配置安全隔离目录，配置未更改。",
    )
}

fn config_quarantine_marker_path(config_path: &Path) -> Result<PathBuf, AppError> {
    config_path
        .parent()
        .map(|directory| directory.join(CONFIG_QUARANTINE_FILE_NAME))
        .ok_or_else(config_quarantine_path_error)
}

pub(crate) fn read_config(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let config_transaction_lock = managed_config_transaction_lock(app)?;
    with_config_transaction_lock(&config_transaction_lock, || read_config_unlocked(app))
}

pub(crate) fn read_cloud_config(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let config_transaction_lock = managed_config_transaction_lock(app)?;
    with_config_transaction_lock(&config_transaction_lock, || read_cloud_config_unlocked(app))
}

fn managed_config_transaction_lock(
    app: &AppHandle,
) -> Result<tauri::State<'_, ConfigTransactionLock>, AppError> {
    app.try_state::<ConfigTransactionLock>().ok_or_else(|| {
        AppError::new(
            "CONFIG_TRANSACTION_STATE_MISSING",
            "配置事务状态尚未就绪，云服务配置未更改。",
        )
    })
}

fn read_config_unlocked(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let path = config_path(app)?;
    let mut credential_backend = SystemCredentialBackend;
    let mut write_config_callback = write_config_at_path;
    read_config_at_path_with_backend(&path, &mut credential_backend, &mut write_config_callback)
}

fn read_cloud_config_unlocked(app: &AppHandle) -> Result<StoredAppConfig, AppError> {
    let path = config_path(app)?;
    let mut credential_backend = SystemCredentialBackend;
    let mut write_config_callback = write_config_at_path;
    let mut quarantine_backend = file_config_quarantine_backend();
    read_cloud_config_at_path_with_backends(
        &path,
        &mut credential_backend,
        &mut write_config_callback,
        &mut quarantine_backend,
    )
}

fn read_config_at_path_with_backend<B, F>(
    path: &Path,
    credential_backend: &mut B,
    write_config_callback: &mut F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let mut quarantine_backend = file_config_quarantine_backend();
    read_config_at_path_with_backends(
        path,
        credential_backend,
        write_config_callback,
        &mut quarantine_backend,
    )
}

fn read_cloud_config_at_path_with_backends<B, F, Q>(
    path: &Path,
    credential_backend: &mut B,
    write_config_callback: &mut F,
    quarantine_backend: &mut Q,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    Q: ConfigQuarantineBackend,
{
    let config = read_config_at_path_with_backends(
        path,
        credential_backend,
        write_config_callback,
        quarantine_backend,
    )?;
    ensure_config_not_quarantined_at_path_with_backend(path, quarantine_backend)?;
    Ok(config)
}

fn read_config_at_path_with_backends<B, F, Q>(
    path: &Path,
    credential_backend: &mut B,
    write_config_callback: &mut F,
    quarantine_backend: &mut Q,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    Q: ConfigQuarantineBackend,
{
    read_config_at_path_with_migration_handler(
        path,
        credential_backend,
        write_config_callback,
        |path, config, credential_backend, write_config_callback| {
            execute_config_transaction_with_quarantine(
                path,
                quarantine_backend,
                PreexistingQuarantinePolicy::Reject,
                || {
                    migrate_config_to_v2_with_backend(
                        path,
                        config,
                        credential_backend,
                        write_config_callback,
                    )
                },
            )
        },
    )
}

fn read_config_at_path_in_transaction_with_backend<B, F>(
    path: &Path,
    credential_backend: &mut B,
    write_config_callback: &mut F,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    read_config_at_path_with_migration_handler(
        path,
        credential_backend,
        write_config_callback,
        migrate_config_to_v2_with_backend,
    )
}

fn read_config_at_path_with_migration_handler<B, F, M>(
    path: &Path,
    credential_backend: &mut B,
    write_config_callback: &mut F,
    migrate_config: M,
) -> Result<StoredAppConfig, AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
    M: FnOnce(&Path, &mut StoredAppConfig, &mut B, &mut F) -> Result<(), AppError>,
{
    if !path.exists() {
        return Ok(StoredAppConfig::default());
    }

    enforce_config_permissions(path)?;

    let raw = fs::read_to_string(path).map_err(|error| {
        AppError::with_detail("CONFIG_READ_FAILED", "读取配置失败。", error.to_string())
    })?;

    let mut config: StoredAppConfig = serde_json::from_str(&raw).map_err(|error| {
        AppError::with_detail(
            "CONFIG_PARSE_FAILED",
            "配置文件格式错误。",
            error.to_string(),
        )
    })?;
    if config.schema_version > CONFIG_SCHEMA_VERSION {
        return Err(AppError::new(
            "CONFIG_VERSION_UNSUPPORTED",
            "配置文件来自更新版本，当前应用无法安全读取。",
        ));
    }

    if config.schema_version < CONFIG_SCHEMA_VERSION || config_contains_plaintext_secret(&config) {
        migrate_config(path, &mut config, credential_backend, write_config_callback)?;
    }

    config.schema_version = CONFIG_SCHEMA_VERSION;
    config.zhipu.dimensions = ZHIPU_EMBEDDING_DIMENSIONS;
    config.zhipu.similarity_threshold =
        normalize_similarity_threshold(config.zhipu.similarity_threshold);
    hydrate_credentials_with_backend(&mut config, credential_backend)?;
    propagate_disclosure_state(&mut config);
    Ok(config)
}

fn default_similarity_threshold() -> f64 {
    TEACHER_CASE_SIMILARITY_THRESHOLD
}

fn legacy_schema_version() -> u8 {
    1
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
        enabled: false,
        base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
        model: "embedding-3".to_string(),
        dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
        allow_insecure_localhost: false,
        similarity_threshold: TEACHER_CASE_SIMILARITY_THRESHOLD,
        credential_status: CredentialStatus::Missing,
        disclosure_accepted_version: None,
    }
}

impl Default for StoredAppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            theme: ThemeId::Claude,
            typography: default_typography_config(),
            deepseek: StoredDeepSeekConfig {
                api_key: None,
                enabled: false,
                base_url: "https://api.deepseek.com".to_string(),
                model: DeepSeekModel::DeepseekV4Flash,
                allow_insecure_localhost: false,
                credential_status: CredentialStatus::Missing,
                disclosure_accepted_version: None,
            },
            zhipu: default_zhipu_config(),
            azure: StoredAzureConfig {
                key: None,
                enabled: false,
                region: String::new(),
                language: "en-US".to_string(),
                credential_status: CredentialStatus::Missing,
                disclosure_accepted_version: None,
            },
            disclosure: StoredCloudDisclosure::default(),
        }
    }
}

impl From<StoredAppConfig> for PublicAppConfig {
    fn from(value: StoredAppConfig) -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            theme: value.theme,
            typography: PublicTypographyConfig {
                font: value.typography.font,
                font_size: value.typography.font_size,
            },
            deepseek: PublicDeepSeekConfig {
                api_key_configured: value.deepseek.credential_status
                    == CredentialStatus::Configured,
                credential_status: value.deepseek.credential_status,
                enabled: value.deepseek.enabled,
                base_url: value.deepseek.base_url,
                model: value.deepseek.model,
                allow_insecure_localhost: value.deepseek.allow_insecure_localhost,
            },
            zhipu: PublicZhipuConfig {
                api_key_configured: value.zhipu.credential_status == CredentialStatus::Configured,
                credential_status: value.zhipu.credential_status,
                enabled: value.zhipu.enabled,
                base_url: value.zhipu.base_url,
                model: value.zhipu.model,
                dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
                similarity_threshold: normalize_similarity_threshold(
                    value.zhipu.similarity_threshold,
                ),
                allow_insecure_localhost: value.zhipu.allow_insecure_localhost,
            },
            azure: PublicAzureConfig {
                key_configured: value.azure.credential_status == CredentialStatus::Configured,
                credential_status: value.azure.credential_status,
                enabled: value.azure.enabled,
                region: value.azure.region,
                language: value.azure.language,
            },
            disclosure: PublicCloudDisclosure {
                latest_version: CLOUD_DISCLOSURE_VERSION,
                accepted_version: value.disclosure.accepted_version,
                notice_required: value.disclosure.migration_notice_pending
                    || value.disclosure.accepted_version != Some(CLOUD_DISCLOSURE_VERSION),
            },
        }
    }
}

#[cfg(test)]
fn validate_config_input(input: &SaveAppConfigInput) -> Result<(), AppError> {
    normalize_config_input(input).map(|_| ())
}

fn normalize_config_input(input: &SaveAppConfigInput) -> Result<NormalizedConfigInput, AppError> {
    let deepseek_endpoint = normalize_cloud_base_url(
        &input.deepseek.base_url,
        input.deepseek.allow_insecure_localhost,
        "DeepSeek",
    )?;
    let zhipu_endpoint = normalize_cloud_base_url(
        &input.zhipu.base_url,
        input.zhipu.allow_insecure_localhost,
        "智谱",
    )?;

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

    let normalized_azure_key = input.azure.key.as_deref().unwrap_or_default().trim();
    let azure_region = if input.azure.region.trim().is_empty()
        && !input.azure.enabled
        && normalized_azure_key.is_empty()
    {
        String::new()
    } else {
        normalize_azure_region(&input.azure.region)?
    };

    Ok(NormalizedConfigInput {
        deepseek_endpoint,
        zhipu_endpoint,
        azure_region,
    })
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

fn write_config_at_path(path: &Path, config: &StoredAppConfig) -> Result<(), AppError> {
    write_config_at_path_with_directory_sync(path, config, sync_directory)
}

fn write_config_at_path_with_directory_sync<F>(
    path: &Path,
    config: &StoredAppConfig,
    mut sync_directory_callback: F,
) -> Result<(), AppError>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let directory = path
        .parent()
        .ok_or_else(|| AppError::new("CONFIG_PATH_FAILED", "无法定位应用配置目录。"))?;

    fs::create_dir_all(directory).map_err(|error| {
        AppError::with_detail(
            "CONFIG_WRITE_FAILED",
            "创建配置目录失败。",
            error.to_string(),
        )
    })?;
    set_directory_permissions(directory)?;

    let previous_config_bytes = if path.exists() {
        Some(fs::read(path).map_err(|error| {
            AppError::with_detail(
                "CONFIG_WRITE_FAILED",
                "读取待替换配置失败。",
                error.to_string(),
            )
        })?)
    } else {
        None
    };

    let raw = serde_json::to_string_pretty(config).map_err(|error| {
        AppError::with_detail(
            "CONFIG_SERIALIZE_FAILED",
            "序列化配置失败。",
            error.to_string(),
        )
    })?;

    let temporary_path = directory.join(format!(".config-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> Result<(), AppError> {
        write_private_file(&temporary_path, raw.as_bytes())?;
        fs::rename(&temporary_path, path).map_err(|error| {
            AppError::with_detail(
                "CONFIG_WRITE_FAILED",
                "原子替换配置失败。",
                error.to_string(),
            )
        })?;
        if let Err(sync_error) = sync_directory_callback(directory) {
            restore_previous_config_after_failed_commit(
                path,
                directory,
                previous_config_bytes.as_deref(),
                &mut sync_directory_callback,
            )?;
            return Err(AppError::with_detail(
                "CONFIG_WRITE_FAILED",
                "同步配置目录失败，原配置已恢复。",
                sync_error.to_string(),
            ));
        }
        Ok(())
    })();

    if write_result.is_err() && temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut temporary_file = open_private_temporary_file(path)?;
    temporary_file.write_all(bytes).map_err(|error| {
        AppError::with_detail("CONFIG_WRITE_FAILED", "保存配置失败。", error.to_string())
    })?;
    temporary_file.flush().map_err(|error| {
        AppError::with_detail("CONFIG_WRITE_FAILED", "保存配置失败。", error.to_string())
    })?;
    temporary_file.sync_all().map_err(|error| {
        AppError::with_detail("CONFIG_WRITE_FAILED", "同步配置失败。", error.to_string())
    })
}

fn restore_previous_config_after_failed_commit<F>(
    path: &Path,
    directory: &Path,
    previous_config_bytes: Option<&[u8]>,
    sync_directory_callback: &mut F,
) -> Result<(), AppError>
where
    F: FnMut(&Path) -> io::Result<()>,
{
    let restore_result = match previous_config_bytes {
        Some(previous_bytes) => {
            let restore_path = directory.join(format!(".config-restore-{}.tmp", Uuid::new_v4()));
            let result = write_private_file(&restore_path, previous_bytes)
                .map_err(|_| {
                    AppError::new(
                        "CONFIG_ROLLBACK_FAILED",
                        "配置持久化失败，且无法恢复原配置；云服务保持阻断。",
                    )
                })
                .and_then(|()| {
                    fs::rename(&restore_path, path).map_err(|error| {
                        AppError::with_detail(
                            "CONFIG_ROLLBACK_FAILED",
                            "配置持久化失败，且无法恢复原配置；云服务保持阻断。",
                            error.to_string(),
                        )
                    })
                });
            if result.is_err() && restore_path.exists() {
                let _ = fs::remove_file(restore_path);
            }
            result
        }
        None => fs::remove_file(path).map_err(|error| {
            AppError::with_detail(
                "CONFIG_ROLLBACK_FAILED",
                "配置持久化失败，且无法恢复空配置状态；云服务保持阻断。",
                error.to_string(),
            )
        }),
    };

    restore_result?;
    let _ = sync_directory_callback(directory);
    Ok(())
}

fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
}

fn config_write_failure_preserved_previous(error: &AppError) -> bool {
    error.code != "CONFIG_ROLLBACK_FAILED"
}

#[cfg(unix)]
fn open_private_temporary_file(path: &Path) -> Result<File, AppError> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| {
            AppError::with_detail(
                "CONFIG_WRITE_FAILED",
                "创建临时配置失败。",
                error.to_string(),
            )
        })
}

#[cfg(not(unix))]
fn open_private_temporary_file(path: &Path) -> Result<File, AppError> {
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| {
            AppError::with_detail(
                "CONFIG_WRITE_FAILED",
                "创建临时配置失败。",
                error.to_string(),
            )
        })
}

fn enforce_config_permissions(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::with_detail("CONFIG_READ_FAILED", "读取配置失败。", error.to_string())
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::new(
            "CONFIG_PATH_UNSAFE",
            "配置文件路径不是普通文件，已阻止读取。",
        ));
    }
    if let Some(directory) = path.parent() {
        set_directory_permissions(directory)?;
    }
    set_file_permissions(path)
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
        AppError::with_detail(
            "CONFIG_PERMISSION_FAILED",
            "设置配置目录权限失败。",
            error.to_string(),
        )
    })
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        AppError::with_detail(
            "CONFIG_PERMISSION_FAILED",
            "设置配置文件权限失败。",
            error.to_string(),
        )
    })
}

#[cfg(not(unix))]
fn set_file_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

fn serialize_optional_secret_as_null<S>(
    _value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_none()
}

fn config_contains_plaintext_secret(config: &StoredAppConfig) -> bool {
    config.deepseek.api_key.is_some()
        || config.zhipu.api_key.is_some()
        || config.azure.key.is_some()
}

fn migrate_config_to_v2_with_backend<B, F>(
    path: &Path,
    config: &mut StoredAppConfig,
    credential_backend: &mut B,
    write_config_callback: &mut F,
) -> Result<(), AppError>
where
    B: CredentialBackend,
    F: FnMut(&Path, &StoredAppConfig) -> Result<(), AppError>,
{
    let legacy_deepseek_key = config.deepseek.api_key.take().and_then(normalize_secret);
    let legacy_zhipu_key = config.zhipu.api_key.take().and_then(normalize_secret);
    let legacy_azure_key = config.azure.key.take().and_then(normalize_secret);
    let had_legacy_credential =
        legacy_deepseek_key.is_some() || legacy_zhipu_key.is_some() || legacy_azure_key.is_some();

    let mut credential_rollbacks = Vec::new();
    if let Some(secret) = legacy_deepseek_key.as_deref() {
        let endpoint = normalize_cloud_base_url(
            &config.deepseek.base_url,
            config.deepseek.allow_insecure_localhost,
            "DeepSeek",
        )?;
        stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::DeepSeek,
            secret,
            &endpoint.binding,
        )?;
        config.deepseek.enabled = true;
    }
    if let Some(secret) = legacy_zhipu_key.as_deref() {
        let endpoint = match normalize_cloud_base_url(
            &config.zhipu.base_url,
            config.zhipu.allow_insecure_localhost,
            "智谱",
        ) {
            Ok(endpoint) => endpoint,
            Err(error) => {
                rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
                return Err(error);
            }
        };
        if let Err(error) = stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Zhipu,
            secret,
            &endpoint.binding,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
        config.zhipu.enabled = true;
    }
    if let Some(secret) = legacy_azure_key.as_deref() {
        let region = match normalize_azure_region(&config.azure.region) {
            Ok(region) => region,
            Err(error) => {
                rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
                return Err(error);
            }
        };
        if let Err(error) = stage_credential_with_backend(
            credential_backend,
            &mut credential_rollbacks,
            CredentialAccount::Azure,
            secret,
            &region,
        ) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
            return Err(error);
        }
        config.azure.region = region;
        config.azure.enabled = true;
    }

    config.schema_version = CONFIG_SCHEMA_VERSION;
    if had_legacy_credential {
        config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        config.disclosure.migration_notice_pending = true;
    }

    if let Err(error) = write_config_callback(path, config) {
        if config_write_failure_preserved_previous(&error) {
            rollback_credentials_with_backend(credential_backend, credential_rollbacks)?;
        }
        return Err(error);
    }
    Ok(())
}

fn stage_credential_with_backend<B: CredentialBackend>(
    credential_backend: &mut B,
    rollbacks: &mut Vec<CredentialRollback>,
    account: CredentialAccount,
    secret: &str,
    binding: &str,
) -> Result<(), AppError> {
    let rollback =
        replace_credential_verified_with_backend(credential_backend, account, secret, binding)?;
    rollbacks.push(rollback);
    Ok(())
}

fn stage_credential_clear_with_backend<B: CredentialBackend>(
    credential_backend: &mut B,
    rollbacks: &mut Vec<CredentialRollback>,
    account: CredentialAccount,
) -> Result<(), AppError> {
    let rollback = clear_credential_verified_with_backend(credential_backend, account)?;
    rollbacks.push(rollback);
    Ok(())
}

fn rollback_credentials_with_backend<B: CredentialBackend>(
    credential_backend: &mut B,
    rollbacks: Vec<CredentialRollback>,
) -> Result<(), AppError> {
    let mut rollback_failed = false;
    for rollback in rollbacks.into_iter().rev() {
        rollback_failed |= rollback_credential_with_backend(credential_backend, rollback).is_err();
    }
    if rollback_failed {
        return Err(AppError::new(
            "CREDENTIAL_ROLLBACK_FAILED",
            "系统钥匙串回滚失败，云服务已阻断；请重新配置凭据。",
        ));
    }
    Ok(())
}

fn hydrate_credentials_with_backend<B: CredentialBackend>(
    config: &mut StoredAppConfig,
    credential_backend: &mut B,
) -> Result<(), AppError> {
    hydrate_deepseek_credential_with_backend(&mut config.deepseek, credential_backend)?;
    hydrate_zhipu_credential_with_backend(&mut config.zhipu, credential_backend)?;
    hydrate_azure_credential_with_backend(&mut config.azure, credential_backend)?;
    Ok(())
}

fn hydrate_deepseek_credential_with_backend<B: CredentialBackend>(
    config: &mut StoredDeepSeekConfig,
    credential_backend: &mut B,
) -> Result<(), AppError> {
    let expected_binding = normalize_cloud_base_url(
        &config.base_url,
        config.allow_insecure_localhost,
        "DeepSeek",
    )
    .ok()
    .map(|endpoint| endpoint.binding);
    let (secret, credential_status) =
        match read_credential_with_backend(credential_backend, CredentialAccount::DeepSeek)? {
            None => (None, CredentialStatus::Missing),
            Some(credential) if Some(&credential.binding) == expected_binding.as_ref() => {
                (Some(credential.secret), CredentialStatus::Configured)
            }
            Some(_) => (None, CredentialStatus::BindingMismatch),
        };
    config.api_key = secret;
    config.credential_status = credential_status;
    Ok(())
}

fn hydrate_zhipu_credential_with_backend<B: CredentialBackend>(
    config: &mut StoredZhipuConfig,
    credential_backend: &mut B,
) -> Result<(), AppError> {
    let expected_binding =
        normalize_cloud_base_url(&config.base_url, config.allow_insecure_localhost, "智谱")
            .ok()
            .map(|endpoint| endpoint.binding);
    let (secret, credential_status) =
        match read_credential_with_backend(credential_backend, CredentialAccount::Zhipu)? {
            None => (None, CredentialStatus::Missing),
            Some(credential) if Some(&credential.binding) == expected_binding.as_ref() => {
                (Some(credential.secret), CredentialStatus::Configured)
            }
            Some(_) => (None, CredentialStatus::BindingMismatch),
        };
    config.api_key = secret;
    config.credential_status = credential_status;
    Ok(())
}

fn hydrate_azure_credential_with_backend<B: CredentialBackend>(
    config: &mut StoredAzureConfig,
    credential_backend: &mut B,
) -> Result<(), AppError> {
    let expected_binding = normalize_azure_region(&config.region).ok();
    let (secret, credential_status) =
        match read_credential_with_backend(credential_backend, CredentialAccount::Azure)? {
            None => (None, CredentialStatus::Missing),
            Some(credential) if Some(&credential.binding) == expected_binding.as_ref() => {
                (Some(credential.secret), CredentialStatus::Configured)
            }
            Some(_) => (None, CredentialStatus::BindingMismatch),
        };
    config.key = secret;
    config.credential_status = credential_status;
    Ok(())
}

fn propagate_disclosure_state(config: &mut StoredAppConfig) {
    let accepted_version = config.disclosure.accepted_version;
    config.deepseek.disclosure_accepted_version = accepted_version;
    config.zhipu.disclosure_accepted_version = accepted_version;
    config.azure.disclosure_accepted_version = accepted_version;
}

fn normalize_secret(secret: String) -> Option<String> {
    let normalized = secret.trim().to_string();
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex as StdMutex};
    use std::time::Duration;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum CredentialOperation {
        Write(CredentialAccount),
        Delete(CredentialAccount),
    }

    #[derive(Default)]
    struct FakeCredentialBackend {
        values: HashMap<CredentialAccount, Vec<u8>>,
        write_count: usize,
        delete_count: usize,
        fail_write_on: Option<usize>,
        fail_delete_on: Option<usize>,
        operations: Vec<CredentialOperation>,
    }

    impl CredentialBackend for FakeCredentialBackend {
        fn read(&mut self, account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
            Ok(self.values.get(&account).cloned())
        }

        fn write(&mut self, account: CredentialAccount, value: &[u8]) -> Result<(), AppError> {
            self.write_count += 1;
            self.operations.push(CredentialOperation::Write(account));
            self.values.insert(account, value.to_vec());
            if self.fail_write_on == Some(self.write_count) {
                return Err(AppError::new(
                    "CREDENTIAL_WRITE_FAILED",
                    "Injected credential write failure.",
                ));
            }
            Ok(())
        }

        fn delete(&mut self, account: CredentialAccount) -> Result<(), AppError> {
            self.delete_count += 1;
            self.operations.push(CredentialOperation::Delete(account));
            self.values.remove(&account);
            if self.fail_delete_on == Some(self.delete_count) {
                return Err(AppError::new(
                    "CREDENTIAL_DELETE_FAILED",
                    "Injected credential delete failure.",
                ));
            }
            Ok(())
        }
    }

    impl FakeCredentialBackend {
        fn reset_operations(&mut self) {
            self.write_count = 0;
            self.delete_count = 0;
            self.fail_write_on = None;
            self.fail_delete_on = None;
            self.operations.clear();
        }
    }

    #[derive(Clone, Default)]
    struct ConcurrentCredentialBackend {
        values: Arc<StdMutex<HashMap<CredentialAccount, Vec<u8>>>>,
    }

    impl CredentialBackend for ConcurrentCredentialBackend {
        fn read(&mut self, account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
            self.values
                .lock()
                .map(|values| values.get(&account).cloned())
                .map_err(|_| concurrent_backend_lock_error())
        }

        fn write(&mut self, account: CredentialAccount, value: &[u8]) -> Result<(), AppError> {
            self.values
                .lock()
                .map_err(|_| concurrent_backend_lock_error())?
                .insert(account, value.to_vec());
            Ok(())
        }

        fn delete(&mut self, account: CredentialAccount) -> Result<(), AppError> {
            self.values
                .lock()
                .map_err(|_| concurrent_backend_lock_error())?
                .remove(&account);
            Ok(())
        }
    }

    fn concurrent_backend_lock_error() -> AppError {
        AppError::new(
            "TEST_CREDENTIAL_BACKEND_LOCK_FAILED",
            "Test credential backend lock failed.",
        )
    }

    fn legacy_config_bytes() -> Vec<u8> {
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "theme": "theme-claude",
            "typography": {
                "font": "system",
                "fontSize": "medium"
            },
            "deepseek": {
                "apiKey": "test-legacy-deepseek-key",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash"
            },
            "zhipu": {
                "apiKey": "test-legacy-zhipu-key",
                "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                "model": "embedding-3",
                "dimensions": ZHIPU_EMBEDDING_DIMENSIONS,
                "similarityThreshold": TEACHER_CASE_SIMILARITY_THRESHOLD
            },
            "azure": {
                "key": "test-legacy-azure-key",
                "region": "EastAsia",
                "language": "en-US"
            }
        }))
        .expect("serialize legacy test config")
    }

    fn write_test_config_bytes(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().expect("config directory"))
            .expect("create config directory");
        fs::write(path, bytes).expect("write test config");
    }

    fn persisted_config_is_legacy(path: &Path) -> bool {
        let value: serde_json::Value = serde_json::from_slice(
            &fs::read(path).expect("read persisted config while counting migrations"),
        )
        .expect("parse persisted config while counting migrations");
        value["schemaVersion"].as_u64().unwrap_or(1) < u64::from(CONFIG_SCHEMA_VERSION)
    }

    fn read_test_config<B: CredentialBackend>(
        path: &Path,
        credential_backend: &mut B,
    ) -> Result<StoredAppConfig, AppError> {
        let mut write_config_callback = write_config_at_path;
        read_config_at_path_with_backend(path, credential_backend, &mut write_config_callback)
    }

    fn seed_test_credential<B: CredentialBackend>(
        credential_backend: &mut B,
        account: CredentialAccount,
        secret: &str,
        binding: &str,
    ) {
        replace_credential_verified_with_backend(credential_backend, account, secret, binding)
            .expect("seed fake credential");
    }

    fn endpoint_change_input() -> SaveAppConfigInput {
        SaveAppConfigInput {
            theme: ThemeId::Claude,
            typography: SaveTypographyConfigInput {
                font: FontPreference::System,
                font_size: FontSizePreference::Medium,
            },
            deepseek: SaveDeepSeekConfigInput {
                api_key: None,
                enabled: false,
                base_url: "https://gateway.example.com/v1".to_string(),
                model: DeepSeekModel::DeepseekV4Flash,
                allow_insecure_localhost: false,
            },
            zhipu: SaveZhipuConfigInput {
                api_key: None,
                enabled: false,
                base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
                model: "embedding-3".to_string(),
                dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
                similarity_threshold: Some(TEACHER_CASE_SIMILARITY_THRESHOLD),
                allow_insecure_localhost: false,
            },
            azure: SaveAzureConfigInput {
                key: None,
                enabled: false,
                region: "westus2".to_string(),
                language: "en-US".to_string(),
            },
        }
    }

    fn cloud_save_input(
        deepseek_key: Option<&str>,
        deepseek_enabled: bool,
        zhipu_key: Option<&str>,
        zhipu_enabled: bool,
    ) -> SaveAppConfigInput {
        SaveAppConfigInput {
            theme: ThemeId::Claude,
            typography: SaveTypographyConfigInput {
                font: FontPreference::System,
                font_size: FontSizePreference::Medium,
            },
            deepseek: SaveDeepSeekConfigInput {
                api_key: deepseek_key.map(str::to_string),
                enabled: deepseek_enabled,
                base_url: "https://api.deepseek.com".to_string(),
                model: DeepSeekModel::DeepseekV4Flash,
                allow_insecure_localhost: false,
            },
            zhipu: SaveZhipuConfigInput {
                api_key: zhipu_key.map(str::to_string),
                enabled: zhipu_enabled,
                base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
                model: "embedding-3".to_string(),
                dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
                similarity_threshold: Some(TEACHER_CASE_SIMILARITY_THRESHOLD),
                allow_insecure_localhost: false,
            },
            azure: SaveAzureConfigInput {
                key: None,
                enabled: false,
                region: String::new(),
                language: "en-US".to_string(),
            },
        }
    }

    fn prepare_clear_transaction(
        account: CredentialAccount,
    ) -> (tempfile::TempDir, PathBuf, FakeCredentialBackend, Vec<u8>) {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut stored_config = StoredAppConfig::default();
        stored_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        let (secret, binding) = match account {
            CredentialAccount::DeepSeek => {
                stored_config.deepseek.enabled = true;
                ("test-deepseek-key", "https://api.deepseek.com")
            }
            CredentialAccount::Zhipu => {
                stored_config.zhipu.enabled = true;
                ("test-zhipu-key", "https://open.bigmodel.cn")
            }
            CredentialAccount::Azure => {
                stored_config.azure.enabled = true;
                stored_config.azure.region = "eastasia".to_string();
                ("test-azure-key", "eastasia")
            }
        };
        write_config_at_path(&config_path, &stored_config).expect("write clear test config");
        let original_config_bytes = fs::read(&config_path).expect("read clear test config");
        let mut credential_backend = FakeCredentialBackend::default();
        seed_test_credential(&mut credential_backend, account, secret, binding);
        credential_backend.reset_operations();

        (
            temporary_directory,
            config_path,
            credential_backend,
            original_config_bytes,
        )
    }

    fn assert_cloud_service_cleared(config: &StoredAppConfig, account: CredentialAccount) {
        match account {
            CredentialAccount::DeepSeek => {
                assert!(!config.deepseek.enabled);
                assert_eq!(config.deepseek.credential_status, CredentialStatus::Missing);
            }
            CredentialAccount::Zhipu => {
                assert!(!config.zhipu.enabled);
                assert_eq!(config.zhipu.credential_status, CredentialStatus::Missing);
            }
            CredentialAccount::Azure => {
                assert!(!config.azure.enabled);
                assert_eq!(config.azure.credential_status, CredentialStatus::Missing);
            }
        }
    }

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

    #[test]
    fn serializes_credential_compatibility_fields_as_null() {
        let mut config = StoredAppConfig::default();
        config.deepseek.api_key = Some("deepseek-secret".to_string());
        config.zhipu.api_key = Some("zhipu-secret".to_string());
        config.azure.key = Some("azure-secret".to_string());

        let serialized = serde_json::to_string(&config).expect("serialize config");

        assert!(!serialized.contains("deepseek-secret"));
        assert!(!serialized.contains("zhipu-secret"));
        assert!(!serialized.contains("azure-secret"));
        let value: serde_json::Value = serde_json::from_str(&serialized).expect("parse config");
        assert!(value["deepseek"]["apiKey"].is_null());
        assert!(value["zhipu"]["apiKey"].is_null());
        assert!(value["azure"]["key"].is_null());
    }

    #[test]
    fn migrates_all_legacy_plaintext_credentials_as_one_verified_transaction() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let original_bytes = legacy_config_bytes();
        write_test_config_bytes(&config_path, &original_bytes);
        let mut credential_backend = FakeCredentialBackend::default();

        let config = read_test_config(&config_path, &mut credential_backend)
            .expect("migrate legacy config with fake credential backend");

        assert_eq!(config.schema_version, CONFIG_SCHEMA_VERSION);
        assert!(config.deepseek.enabled);
        assert!(config.zhipu.enabled);
        assert!(config.azure.enabled);
        assert_eq!(
            config.deepseek.credential_status,
            CredentialStatus::Configured
        );
        assert_eq!(config.zhipu.credential_status, CredentialStatus::Configured);
        assert_eq!(config.azure.credential_status, CredentialStatus::Configured);
        assert_eq!(
            config.disclosure.accepted_version,
            Some(CLOUD_DISCLOSURE_VERSION)
        );
        assert!(config.disclosure.migration_notice_pending);

        let persisted_bytes = fs::read(&config_path).expect("read migrated config");
        let persisted_value: serde_json::Value =
            serde_json::from_slice(&persisted_bytes).expect("parse migrated config");
        assert_eq!(persisted_value["schemaVersion"], CONFIG_SCHEMA_VERSION);
        assert!(persisted_value["deepseek"]["apiKey"].is_null());
        assert!(persisted_value["zhipu"]["apiKey"].is_null());
        assert!(persisted_value["azure"]["key"].is_null());
        for forbidden_secret in [
            "test-legacy-deepseek-key",
            "test-legacy-zhipu-key",
            "test-legacy-azure-key",
        ] {
            assert!(!String::from_utf8_lossy(&persisted_bytes).contains(forbidden_secret));
        }

        let deepseek_credential =
            read_credential_with_backend(&mut credential_backend, CredentialAccount::DeepSeek)
                .expect("read DeepSeek fake credential")
                .expect("DeepSeek credential");
        assert_eq!(deepseek_credential.secret, "test-legacy-deepseek-key");
        assert_eq!(deepseek_credential.binding, "https://api.deepseek.com");
        let zhipu_credential =
            read_credential_with_backend(&mut credential_backend, CredentialAccount::Zhipu)
                .expect("read Zhipu fake credential")
                .expect("Zhipu credential");
        assert_eq!(zhipu_credential.secret, "test-legacy-zhipu-key");
        assert_eq!(zhipu_credential.binding, "https://open.bigmodel.cn");
        let azure_credential =
            read_credential_with_backend(&mut credential_backend, CredentialAccount::Azure)
                .expect("read Azure fake credential")
                .expect("Azure credential");
        assert_eq!(azure_credential.secret, "test-legacy-azure-key");
        assert_eq!(azure_credential.binding, "eastasia");
    }

    #[test]
    fn migration_write_failures_restore_original_file_and_credentials_in_reverse_order() {
        for (failed_write, expected_delete_order) in [
            (
                2,
                vec![CredentialAccount::Zhipu, CredentialAccount::DeepSeek],
            ),
            (
                3,
                vec![
                    CredentialAccount::Azure,
                    CredentialAccount::Zhipu,
                    CredentialAccount::DeepSeek,
                ],
            ),
        ] {
            let temporary_directory = tempfile::tempdir().expect("temporary directory");
            let config_path = temporary_directory.path().join("settings/config.json");
            let original_bytes = legacy_config_bytes();
            write_test_config_bytes(&config_path, &original_bytes);
            let mut credential_backend = FakeCredentialBackend {
                fail_write_on: Some(failed_write),
                ..Default::default()
            };
            let original_credential_values = credential_backend.values.clone();

            let error = match read_test_config(&config_path, &mut credential_backend) {
                Err(error) => error,
                Ok(_) => panic!("injected credential write failure must abort migration"),
            };

            assert_eq!(error.code, "CREDENTIAL_WRITE_FAILED");
            assert_eq!(
                fs::read(&config_path).expect("read original config after failed migration"),
                original_bytes
            );
            assert_eq!(credential_backend.values, original_credential_values);
            let delete_order = credential_backend
                .operations
                .iter()
                .filter_map(|operation| match operation {
                    CredentialOperation::Delete(account) => Some(*account),
                    CredentialOperation::Write(_) => None,
                })
                .collect::<Vec<_>>();
            assert_eq!(delete_order, expected_delete_order);
        }
    }

    #[test]
    fn migration_config_commit_failure_restores_previous_credential_store_and_file_bytes() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let original_bytes = legacy_config_bytes();
        write_test_config_bytes(&config_path, &original_bytes);
        let mut credential_backend = FakeCredentialBackend::default();
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::DeepSeek,
            "test-previous-deepseek-key",
            "https://previous-deepseek.example.com",
        );
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::Zhipu,
            "test-previous-zhipu-key",
            "https://previous-zhipu.example.com",
        );
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::Azure,
            "test-previous-azure-key",
            "westus2",
        );
        let original_credential_values = credential_backend.values.clone();
        credential_backend.reset_operations();
        let mut failing_write_callback = |_: &Path, _: &StoredAppConfig| {
            Err(AppError::new(
                "CONFIG_WRITE_FAILED",
                "Injected config commit failure.",
            ))
        };

        let error = match read_config_at_path_with_backend(
            &config_path,
            &mut credential_backend,
            &mut failing_write_callback,
        ) {
            Err(error) => error,
            Ok(_) => panic!("config commit failure must abort migration"),
        };

        assert_eq!(error.code, "CONFIG_WRITE_FAILED");
        assert_eq!(
            fs::read(&config_path).expect("read original config after commit failure"),
            original_bytes
        );
        assert_eq!(credential_backend.values, original_credential_values);
        assert_eq!(
            &credential_backend.operations[credential_backend.operations.len() - 3..],
            &[
                CredentialOperation::Write(CredentialAccount::Azure),
                CredentialOperation::Write(CredentialAccount::Zhipu),
                CredentialOperation::Write(CredentialAccount::DeepSeek),
            ]
        );
    }

    #[test]
    fn changing_cloud_origin_or_azure_region_clears_only_the_invalidated_credentials() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut stored_config = StoredAppConfig::default();
        stored_config.azure.region = "eastasia".to_string();
        stored_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &stored_config).expect("write v2 config");
        let mut credential_backend = FakeCredentialBackend::default();
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::DeepSeek,
            "test-deepseek-key",
            "https://api.deepseek.com",
        );
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::Zhipu,
            "test-zhipu-key",
            "https://open.bigmodel.cn",
        );
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::Azure,
            "test-azure-key",
            "eastasia",
        );
        credential_backend.reset_operations();

        let saved_config = save_app_config_at_path_with_backend(
            &config_path,
            endpoint_change_input(),
            &mut credential_backend,
            write_config_at_path,
        )
        .expect("save endpoint changes");

        assert_eq!(
            saved_config.deepseek.credential_status,
            CredentialStatus::Missing
        );
        assert_eq!(
            saved_config.zhipu.credential_status,
            CredentialStatus::Configured
        );
        assert_eq!(
            saved_config.azure.credential_status,
            CredentialStatus::Missing
        );
        assert!(!credential_backend
            .values
            .contains_key(&CredentialAccount::DeepSeek));
        assert!(credential_backend
            .values
            .contains_key(&CredentialAccount::Zhipu));
        assert!(!credential_backend
            .values
            .contains_key(&CredentialAccount::Azure));
        assert_eq!(
            credential_backend.operations,
            vec![
                CredentialOperation::Delete(CredentialAccount::DeepSeek),
                CredentialOperation::Delete(CredentialAccount::Azure),
            ]
        );
        let persisted_value: serde_json::Value =
            serde_json::from_slice(&fs::read(&config_path).expect("read endpoint-change config"))
                .expect("parse endpoint-change config");
        assert_eq!(
            persisted_value["deepseek"]["baseUrl"],
            "https://gateway.example.com/v1"
        );
        assert_eq!(persisted_value["azure"]["region"], "westus2");
    }

    #[test]
    fn credential_clear_failure_preserves_enabled_config_and_credential_for_every_account() {
        for account in [
            CredentialAccount::DeepSeek,
            CredentialAccount::Zhipu,
            CredentialAccount::Azure,
        ] {
            let (_temporary_directory, config_path, mut credential_backend, original_config_bytes) =
                prepare_clear_transaction(account);
            let original_credential_values = credential_backend.values.clone();
            credential_backend.fail_delete_on = Some(1);

            let error = match clear_cloud_credential_at_path_with_backend(
                &config_path,
                account,
                &mut credential_backend,
                write_config_at_path,
            ) {
                Err(error) => error,
                Ok(_) => panic!("credential clear failure must abort config update"),
            };

            assert_eq!(error.code, "CREDENTIAL_DELETE_FAILED");
            assert_eq!(
                fs::read(&config_path).expect("read config after failed credential clear"),
                original_config_bytes
            );
            assert_eq!(credential_backend.values, original_credential_values);
        }
    }

    #[test]
    fn clear_config_commit_failure_restores_credential_for_every_account() {
        for account in [
            CredentialAccount::DeepSeek,
            CredentialAccount::Zhipu,
            CredentialAccount::Azure,
        ] {
            let (_temporary_directory, config_path, mut credential_backend, original_config_bytes) =
                prepare_clear_transaction(account);
            let original_credential_values = credential_backend.values.clone();

            let error = match clear_cloud_credential_at_path_with_backend(
                &config_path,
                account,
                &mut credential_backend,
                |_, _| {
                    Err(AppError::new(
                        "CONFIG_WRITE_FAILED",
                        "Injected config commit failure.",
                    ))
                },
            ) {
                Err(error) => error,
                Ok(_) => panic!("config commit failure must restore cleared credential"),
            };

            assert_eq!(error.code, "CONFIG_WRITE_FAILED");
            assert_eq!(
                fs::read(&config_path).expect("read config after failed clear commit"),
                original_config_bytes
            );
            assert_eq!(credential_backend.values, original_credential_values);
        }
    }

    #[test]
    fn successful_clear_disables_service_and_removes_credential_for_every_account() {
        for account in [
            CredentialAccount::DeepSeek,
            CredentialAccount::Zhipu,
            CredentialAccount::Azure,
        ] {
            let (_temporary_directory, config_path, mut credential_backend, _) =
                prepare_clear_transaction(account);

            let config = clear_cloud_credential_at_path_with_backend(
                &config_path,
                account,
                &mut credential_backend,
                write_config_at_path,
            )
            .expect("clear cloud credential transaction");

            assert_cloud_service_cleared(&config, account);
            assert!(!credential_backend.values.contains_key(&account));
            let persisted_value: serde_json::Value = serde_json::from_slice(
                &fs::read(&config_path).expect("read successful clear config"),
            )
            .expect("parse successful clear config");
            let service_name = match account {
                CredentialAccount::DeepSeek => "deepseek",
                CredentialAccount::Zhipu => "zhipu",
                CredentialAccount::Azure => "azure",
            };
            assert_eq!(persisted_value[service_name]["enabled"], false);
        }
    }

    #[test]
    fn catastrophic_config_commit_and_restore_failure_persists_quarantine_across_reads() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let original_config_bytes = fs::read(&config_path).expect("read initial config");
        let credential_backend = ConcurrentCredentialBackend::default();
        let mut transaction_backend = credential_backend.clone();
        let mut quarantine_backend = file_config_quarantine_backend();

        let error = match save_app_config_at_path_with_backends(
            &config_path,
            cloud_save_input(Some("test-quarantined-deepseek-key"), true, None, false),
            &mut transaction_backend,
            |_, _| {
                Err(AppError::new(
                    "CONFIG_ROLLBACK_FAILED",
                    "Injected commit and restore failure.",
                ))
            },
            &mut quarantine_backend,
        ) {
            Err(error) => error,
            Ok(_) => panic!("catastrophic config rollback failure must fail"),
        };

        assert_eq!(error.code, "CONFIG_ROLLBACK_FAILED");
        assert_eq!(
            fs::read(&config_path).expect("read config after catastrophic failure"),
            original_config_bytes
        );
        assert!(config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .is_file());

        let mut fresh_credential_backend = credential_backend.clone();
        let mut fresh_write_callback = write_config_at_path;
        let mut fresh_quarantine_backend = file_config_quarantine_backend();
        let cloud_error = match read_cloud_config_at_path_with_backends(
            &config_path,
            &mut fresh_credential_backend,
            &mut fresh_write_callback,
            &mut fresh_quarantine_backend,
        ) {
            Err(error) => error,
            Ok(_) => panic!("persisted quarantine must block a fresh cloud config read"),
        };
        let serialized_error = serde_json::to_string(&cloud_error).expect("serialize cloud error");

        assert_eq!(cloud_error.code, "CONFIG_TRANSACTION_QUARANTINED");
        assert!(!serialized_error.contains("test-quarantined-deepseek-key"));
        assert!(!serialized_error.contains(&config_path.to_string_lossy().to_string()));
        let mut settings_backend = credential_backend.clone();
        assert!(read_test_config(&config_path, &mut settings_backend).is_ok());
    }

    #[test]
    fn fully_rolled_back_credential_failure_clears_new_quarantine_marker() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let original_config_bytes = fs::read(&config_path).expect("read initial config");
        let mut credential_backend = FakeCredentialBackend {
            fail_write_on: Some(1),
            ..Default::default()
        };

        let error = match save_app_config_at_path_with_backend(
            &config_path,
            cloud_save_input(Some("test-failed-deepseek-key"), true, None, false),
            &mut credential_backend,
            write_config_at_path,
        ) {
            Err(error) => error,
            Ok(_) => panic!("injected credential failure must fail save"),
        };

        assert_eq!(error.code, "CREDENTIAL_WRITE_FAILED");
        assert_eq!(
            fs::read(&config_path).expect("read config after credential failure"),
            original_config_bytes
        );
        assert!(credential_backend.values.is_empty());
        assert!(!config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn successful_repair_transaction_clears_preexisting_quarantine_marker() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let mut marker_backend = file_config_quarantine_backend();
        marker_backend
            .begin(&config_path)
            .expect("create preexisting quarantine marker");
        let mut credential_backend = FakeCredentialBackend::default();

        let config = save_app_config_at_path_with_backend(
            &config_path,
            cloud_save_input(Some("test-repair-deepseek-key"), true, None, false),
            &mut credential_backend,
            write_config_at_path,
        )
        .expect("successful repair save");

        assert_eq!(
            config.deepseek.credential_status,
            CredentialStatus::Configured
        );
        assert!(!config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn preexisting_quarantine_rejects_disclosure_and_single_clear_without_mutation() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.deepseek.enabled = true;
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let original_config_bytes = fs::read(&config_path).expect("read initial config");
        let mut credential_backend = FakeCredentialBackend::default();
        seed_test_credential(
            &mut credential_backend,
            CredentialAccount::DeepSeek,
            "test-existing-deepseek-key",
            "https://api.deepseek.com",
        );
        credential_backend.reset_operations();
        let original_credentials = credential_backend.values.clone();
        let mut quarantine_backend = file_config_quarantine_backend();
        quarantine_backend
            .begin(&config_path)
            .expect("create preexisting quarantine marker");

        let disclosure_error = accept_cloud_disclosure_at_path_with_backends(
            &config_path,
            &mut credential_backend,
            write_config_at_path,
            &mut quarantine_backend,
        )
        .err()
        .expect("disclosure must not repair preexisting quarantine");
        let clear_error = clear_cloud_credential_at_path_with_backends(
            &config_path,
            CredentialAccount::DeepSeek,
            &mut credential_backend,
            write_config_at_path,
            &mut quarantine_backend,
        )
        .err()
        .expect("single clear must not repair preexisting quarantine");

        assert_eq!(disclosure_error.code, "CONFIG_TRANSACTION_QUARANTINED");
        assert_eq!(clear_error.code, "CONFIG_TRANSACTION_QUARANTINED");
        assert_eq!(
            fs::read(&config_path).expect("read config after rejected repairs"),
            original_config_bytes
        );
        assert_eq!(credential_backend.values, original_credentials);
        assert!(credential_backend.operations.is_empty());
        assert!(config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn preexisting_quarantine_prevents_automatic_legacy_migration() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let original_config_bytes = legacy_config_bytes();
        write_test_config_bytes(&config_path, &original_config_bytes);
        let mut credential_backend = FakeCredentialBackend::default();
        let mut quarantine_backend = file_config_quarantine_backend();
        quarantine_backend
            .begin(&config_path)
            .expect("create preexisting quarantine marker");

        let error = read_test_config(&config_path, &mut credential_backend)
            .err()
            .expect("automatic migration must not repair preexisting quarantine");

        assert_eq!(error.code, "CONFIG_TRANSACTION_QUARANTINED");
        assert_eq!(
            fs::read(&config_path).expect("read unchanged legacy config"),
            original_config_bytes
        );
        assert!(credential_backend.values.is_empty());
        assert!(config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn quarantine_creation_sync_failure_prevents_any_config_or_credential_mutation() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let original_config_bytes = fs::read(&config_path).expect("read initial config");
        let mut credential_backend = FakeCredentialBackend::default();
        let mut quarantine_backend = FileConfigQuarantineBackend {
            sync_directory_callback: |_: &Path| {
                Err(io::Error::other(
                    "injected quarantine creation sync failure",
                ))
            },
        };

        let error = match save_app_config_at_path_with_backends(
            &config_path,
            cloud_save_input(Some("test-never-written-key"), true, None, false),
            &mut credential_backend,
            write_config_at_path,
            &mut quarantine_backend,
        ) {
            Err(error) => error,
            Ok(_) => panic!("quarantine creation failure must abort save"),
        };

        assert_eq!(error.code, "CONFIG_QUARANTINE_BEGIN_FAILED");
        assert_eq!(
            fs::read(&config_path).expect("read config after quarantine begin failure"),
            original_config_bytes
        );
        assert!(credential_backend.values.is_empty());
        let marker_path =
            config_quarantine_marker_path(&config_path).expect("quarantine marker path");
        assert!(marker_path.exists());
        assert_eq!(
            fs::read(&marker_path).expect("read quarantine marker"),
            CONFIG_QUARANTINE_CONTENT
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(marker_path)
                    .expect("quarantine marker metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn quarantine_clear_sync_failure_restores_marker_and_keeps_cloud_blocked() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let credential_backend = ConcurrentCredentialBackend::default();
        let mut transaction_backend = credential_backend.clone();
        let mut sync_count = 0_usize;
        let mut quarantine_backend = FileConfigQuarantineBackend {
            sync_directory_callback: |directory: &Path| {
                sync_count += 1;
                if sync_count == 2 {
                    Err(io::Error::other("injected quarantine clear sync failure"))
                } else {
                    sync_directory(directory)
                }
            },
        };

        let error = match save_app_config_at_path_with_backends(
            &config_path,
            cloud_save_input(Some("test-committed-deepseek-key"), true, None, false),
            &mut transaction_backend,
            write_config_at_path,
            &mut quarantine_backend,
        ) {
            Err(error) => error,
            Ok(_) => panic!("quarantine clear sync failure must keep transaction blocked"),
        };

        assert_eq!(error.code, "CONFIG_QUARANTINE_CLEAR_FAILED");
        assert!(config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .is_file());
        let mut fresh_backend = credential_backend.clone();
        let mut write_callback = write_config_at_path;
        let mut fresh_quarantine_backend = file_config_quarantine_backend();
        let cloud_error = read_cloud_config_at_path_with_backends(
            &config_path,
            &mut fresh_backend,
            &mut write_callback,
            &mut fresh_quarantine_backend,
        )
        .err()
        .expect("restored marker must block cloud read");
        assert_eq!(cloud_error.code, "CONFIG_TRANSACTION_QUARANTINED");
    }

    #[test]
    fn quarantine_marker_removal_failure_keeps_fail_closed_path_present() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let marker_path =
            config_quarantine_marker_path(&config_path).expect("quarantine marker path");
        let mut quarantine_backend = file_config_quarantine_backend();

        let error = execute_config_transaction_with_quarantine(
            &config_path,
            &mut quarantine_backend,
            PreexistingQuarantinePolicy::Reject,
            || {
                fs::remove_file(&marker_path).expect("replace marker file with directory");
                fs::create_dir(&marker_path).expect("create non-removable marker directory");
                Ok(())
            },
        )
        .expect_err("marker removal failure must fail closed");

        assert_eq!(error.code, "CONFIG_QUARANTINE_CLEAR_FAILED");
        assert!(marker_path.exists());
        assert!(file_config_quarantine_exists(&config_path).expect("check quarantine marker"));
    }

    #[test]
    fn disclosure_only_transaction_is_also_wrapped_by_quarantine_marker() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        write_config_at_path(&config_path, &StoredAppConfig::default())
            .expect("write initial config");
        let mut credential_backend = FakeCredentialBackend::default();
        let mut sync_count = 0_usize;
        let mut quarantine_backend = FileConfigQuarantineBackend {
            sync_directory_callback: |directory: &Path| {
                sync_count += 1;
                sync_directory(directory)
            },
        };

        let config = accept_cloud_disclosure_at_path_with_backends(
            &config_path,
            &mut credential_backend,
            write_config_at_path,
            &mut quarantine_backend,
        )
        .expect("accept disclosure transaction");

        assert_eq!(
            config.disclosure.accepted_version,
            Some(CLOUD_DISCLOSURE_VERSION)
        );
        assert_eq!(sync_count, 2);
        assert!(!config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn transaction_lock_serializes_save_then_save_without_losing_first_credential() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let credential_backend = ConcurrentCredentialBackend::default();
        let config_transaction_lock = Arc::new(ConfigTransactionLock::default());
        let (first_write_reached_sender, first_write_reached_receiver) = mpsc::channel();
        let (release_first_write_sender, release_first_write_receiver) = mpsc::channel();

        let first_path = config_path.clone();
        let mut first_backend = credential_backend.clone();
        let first_lock = Arc::clone(&config_transaction_lock);
        let first_transaction = std::thread::spawn(move || {
            with_config_transaction_lock(&first_lock, || {
                save_app_config_at_path_with_backend(
                    &first_path,
                    cloud_save_input(Some("test-first-deepseek-key"), true, None, false),
                    &mut first_backend,
                    |path, config| {
                        first_write_reached_sender
                            .send(())
                            .expect("signal first config write");
                        release_first_write_receiver
                            .recv()
                            .expect("release first config write");
                        write_config_at_path(path, config)
                    },
                )
            })
        });
        first_write_reached_receiver
            .recv()
            .expect("first transaction reached controlled write");

        let second_path = config_path.clone();
        let mut second_backend = credential_backend.clone();
        let second_lock = Arc::clone(&config_transaction_lock);
        let (second_attempt_sender, second_attempt_receiver) = mpsc::channel();
        let (second_completed_sender, second_completed_receiver) = mpsc::channel();
        let second_transaction = std::thread::spawn(move || {
            second_attempt_sender
                .send(())
                .expect("signal second transaction attempt");
            let result = with_config_transaction_lock(&second_lock, || {
                save_app_config_at_path_with_backend(
                    &second_path,
                    cloud_save_input(None, true, Some("test-second-zhipu-key"), true),
                    &mut second_backend,
                    write_config_at_path,
                )
            });
            second_completed_sender
                .send(())
                .expect("signal second transaction completion");
            result
        });
        second_attempt_receiver
            .recv()
            .expect("second transaction attempted lock");
        assert!(matches!(
            second_completed_receiver.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_first_write_sender
            .send(())
            .expect("release first transaction");
        for transaction in [first_transaction, second_transaction] {
            match transaction.join().expect("join config transaction") {
                Ok(_) => {}
                Err(error) => panic!("config transaction failed: {}", error.code),
            }
        }

        let mut final_backend = credential_backend.clone();
        let final_config = read_test_config(&config_path, &mut final_backend)
            .expect("read serialized save result");
        assert!(final_config.deepseek.enabled);
        assert!(final_config.zhipu.enabled);
        assert_eq!(
            final_config.deepseek.credential_status,
            CredentialStatus::Configured
        );
        assert_eq!(
            final_config.zhipu.credential_status,
            CredentialStatus::Configured
        );
        assert_eq!(
            final_config.deepseek.api_key.as_deref(),
            Some("test-first-deepseek-key")
        );
        assert_eq!(
            final_config.zhipu.api_key.as_deref(),
            Some("test-second-zhipu-key")
        );
    }

    #[test]
    fn transaction_lock_serializes_legacy_get_then_save_and_migrates_once() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        write_test_config_bytes(&config_path, &legacy_config_bytes());
        let credential_backend = ConcurrentCredentialBackend::default();
        let config_transaction_lock = Arc::new(ConfigTransactionLock::default());
        let migration_count = Arc::new(AtomicUsize::new(0));
        let (migration_write_reached_sender, migration_write_reached_receiver) = mpsc::channel();
        let (release_migration_write_sender, release_migration_write_receiver) = mpsc::channel();

        let get_path = config_path.clone();
        let mut get_backend = credential_backend.clone();
        let get_lock = Arc::clone(&config_transaction_lock);
        let get_migration_count = Arc::clone(&migration_count);
        let get_transaction = std::thread::spawn(move || {
            with_config_transaction_lock(&get_lock, || {
                let mut write_callback = |path: &Path, config: &StoredAppConfig| {
                    if persisted_config_is_legacy(path) {
                        get_migration_count.fetch_add(1, Ordering::SeqCst);
                    }
                    migration_write_reached_sender
                        .send(())
                        .expect("signal migration config write");
                    release_migration_write_receiver
                        .recv()
                        .expect("release migration config write");
                    write_config_at_path(path, config)
                };
                read_config_at_path_with_backend(&get_path, &mut get_backend, &mut write_callback)
            })
        });
        migration_write_reached_receiver
            .recv()
            .expect("legacy get reached migration write");

        let save_path = config_path.clone();
        let mut save_backend = credential_backend.clone();
        let save_lock = Arc::clone(&config_transaction_lock);
        let save_migration_count = Arc::clone(&migration_count);
        let (save_attempt_sender, save_attempt_receiver) = mpsc::channel();
        let (save_completed_sender, save_completed_receiver) = mpsc::channel();
        let save_transaction = std::thread::spawn(move || {
            save_attempt_sender
                .send(())
                .expect("signal save transaction attempt");
            let result = with_config_transaction_lock(&save_lock, || {
                save_app_config_at_path_with_backend(
                    &save_path,
                    cloud_save_input(None, true, Some("test-post-migration-zhipu-key"), true),
                    &mut save_backend,
                    |path, config| {
                        if persisted_config_is_legacy(path) {
                            save_migration_count.fetch_add(1, Ordering::SeqCst);
                        }
                        write_config_at_path(path, config)
                    },
                )
            });
            save_completed_sender
                .send(())
                .expect("signal save transaction completion");
            result
        });
        save_attempt_receiver
            .recv()
            .expect("save transaction attempted lock");
        assert!(matches!(
            save_completed_receiver.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_migration_write_sender
            .send(())
            .expect("release migration transaction");
        match get_transaction.join().expect("join legacy get transaction") {
            Ok(_) => {}
            Err(error) => panic!("legacy get transaction failed: {}", error.code),
        }
        match save_transaction.join().expect("join post-migration save") {
            Ok(_) => {}
            Err(error) => panic!("post-migration save failed: {}", error.code),
        }

        assert_eq!(migration_count.load(Ordering::SeqCst), 1);
        let mut final_backend = credential_backend.clone();
        let final_config = read_test_config(&config_path, &mut final_backend)
            .expect("read get-save config result");
        assert_eq!(
            final_config.deepseek.api_key.as_deref(),
            Some("test-legacy-deepseek-key")
        );
        assert_eq!(
            final_config.zhipu.api_key.as_deref(),
            Some("test-post-migration-zhipu-key")
        );
    }

    #[test]
    fn transaction_lock_serializes_two_cloud_reads_and_runs_legacy_migration_once() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        write_test_config_bytes(&config_path, &legacy_config_bytes());
        let credential_backend = ConcurrentCredentialBackend::default();
        let config_transaction_lock = Arc::new(ConfigTransactionLock::default());
        let migration_count = Arc::new(AtomicUsize::new(0));
        let (first_migration_reached_sender, first_migration_reached_receiver) = mpsc::channel();
        let (release_first_migration_sender, release_first_migration_receiver) = mpsc::channel();

        let first_path = config_path.clone();
        let mut first_backend = credential_backend.clone();
        let first_lock = Arc::clone(&config_transaction_lock);
        let first_migration_count = Arc::clone(&migration_count);
        let first_cloud_read = std::thread::spawn(move || {
            with_config_transaction_lock(&first_lock, || {
                let mut quarantine_backend = file_config_quarantine_backend();
                let mut write_callback = |path: &Path, config: &StoredAppConfig| {
                    if persisted_config_is_legacy(path) {
                        first_migration_count.fetch_add(1, Ordering::SeqCst);
                    }
                    first_migration_reached_sender
                        .send(())
                        .expect("signal first cloud migration write");
                    release_first_migration_receiver
                        .recv()
                        .expect("release first cloud migration write");
                    write_config_at_path(path, config)
                };
                read_cloud_config_at_path_with_backends(
                    &first_path,
                    &mut first_backend,
                    &mut write_callback,
                    &mut quarantine_backend,
                )
            })
        });
        first_migration_reached_receiver
            .recv()
            .expect("first cloud read reached migration write");

        let second_path = config_path.clone();
        let mut second_backend = credential_backend.clone();
        let second_lock = Arc::clone(&config_transaction_lock);
        let second_migration_count = Arc::clone(&migration_count);
        let (second_attempt_sender, second_attempt_receiver) = mpsc::channel();
        let (second_completed_sender, second_completed_receiver) = mpsc::channel();
        let second_cloud_read = std::thread::spawn(move || {
            second_attempt_sender
                .send(())
                .expect("signal second cloud read attempt");
            let result = with_config_transaction_lock(&second_lock, || {
                let mut quarantine_backend = file_config_quarantine_backend();
                let mut write_callback = |path: &Path, config: &StoredAppConfig| {
                    if persisted_config_is_legacy(path) {
                        second_migration_count.fetch_add(1, Ordering::SeqCst);
                    }
                    write_config_at_path(path, config)
                };
                read_cloud_config_at_path_with_backends(
                    &second_path,
                    &mut second_backend,
                    &mut write_callback,
                    &mut quarantine_backend,
                )
            });
            second_completed_sender
                .send(())
                .expect("signal second cloud read completion");
            result
        });
        second_attempt_receiver
            .recv()
            .expect("second cloud read attempted lock");
        assert!(matches!(
            second_completed_receiver.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_first_migration_sender
            .send(())
            .expect("release first cloud migration");
        for cloud_read in [first_cloud_read, second_cloud_read] {
            match cloud_read.join().expect("join cloud config read") {
                Ok(config) => {
                    assert_eq!(
                        config.deepseek.credential_status,
                        CredentialStatus::Configured
                    );
                }
                Err(error) => panic!("cloud config read failed: {}", error.code),
            }
        }

        assert_eq!(migration_count.load(Ordering::SeqCst), 1);
        assert!(!config_quarantine_marker_path(&config_path)
            .expect("quarantine marker path")
            .exists());
    }

    #[test]
    fn transaction_lock_serializes_save_then_clear_without_rollback_overwrite() {
        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        let mut initial_config = StoredAppConfig::default();
        initial_config.deepseek.enabled = true;
        initial_config.disclosure.accepted_version = Some(CLOUD_DISCLOSURE_VERSION);
        write_config_at_path(&config_path, &initial_config).expect("write initial config");
        let credential_backend = ConcurrentCredentialBackend::default();
        let mut credential_seed_backend = credential_backend.clone();
        seed_test_credential(
            &mut credential_seed_backend,
            CredentialAccount::DeepSeek,
            "test-existing-deepseek-key",
            "https://api.deepseek.com",
        );
        let config_transaction_lock = Arc::new(ConfigTransactionLock::default());
        let (save_write_reached_sender, save_write_reached_receiver) = mpsc::channel();
        let (release_save_write_sender, release_save_write_receiver) = mpsc::channel();

        let save_path = config_path.clone();
        let mut save_backend = credential_backend.clone();
        let save_lock = Arc::clone(&config_transaction_lock);
        let save_transaction = std::thread::spawn(move || {
            with_config_transaction_lock(&save_lock, || {
                save_app_config_at_path_with_backend(
                    &save_path,
                    cloud_save_input(None, true, Some("test-new-zhipu-key"), true),
                    &mut save_backend,
                    |path, config| {
                        save_write_reached_sender
                            .send(())
                            .expect("signal save config write");
                        release_save_write_receiver
                            .recv()
                            .expect("release save config write");
                        write_config_at_path(path, config)
                    },
                )
            })
        });
        save_write_reached_receiver
            .recv()
            .expect("save transaction reached controlled write");

        let clear_path = config_path.clone();
        let mut clear_backend = credential_backend.clone();
        let clear_lock = Arc::clone(&config_transaction_lock);
        let (clear_attempt_sender, clear_attempt_receiver) = mpsc::channel();
        let (clear_completed_sender, clear_completed_receiver) = mpsc::channel();
        let clear_transaction = std::thread::spawn(move || {
            clear_attempt_sender
                .send(())
                .expect("signal clear transaction attempt");
            let result = with_config_transaction_lock(&clear_lock, || {
                clear_cloud_credential_at_path_with_backend(
                    &clear_path,
                    CredentialAccount::DeepSeek,
                    &mut clear_backend,
                    write_config_at_path,
                )
            });
            clear_completed_sender
                .send(())
                .expect("signal clear transaction completion");
            result
        });
        clear_attempt_receiver
            .recv()
            .expect("clear transaction attempted lock");
        assert!(matches!(
            clear_completed_receiver.recv_timeout(Duration::from_millis(50)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_save_write_sender
            .send(())
            .expect("release save transaction");
        for transaction in [save_transaction, clear_transaction] {
            match transaction.join().expect("join config transaction") {
                Ok(_) => {}
                Err(error) => panic!("config transaction failed: {}", error.code),
            }
        }

        let mut final_backend = credential_backend.clone();
        let final_config = read_test_config(&config_path, &mut final_backend)
            .expect("read serialized save-clear result");
        assert!(!final_config.deepseek.enabled);
        assert_eq!(
            final_config.deepseek.credential_status,
            CredentialStatus::Missing
        );
        assert!(final_config.zhipu.enabled);
        assert_eq!(
            final_config.zhipu.credential_status,
            CredentialStatus::Configured
        );
        assert_eq!(
            final_config.zhipu.api_key.as_deref(),
            Some("test-new-zhipu-key")
        );
    }

    #[test]
    fn poisoned_config_transaction_lock_returns_redacted_error() {
        let config_transaction_lock = ConfigTransactionLock::default();
        let _ = std::panic::catch_unwind(|| {
            let _transaction_guard = config_transaction_lock
                .0
                .lock()
                .expect("acquire transaction lock before injected panic");
            panic!("injected config transaction panic");
        });

        let error = with_config_transaction_lock(&config_transaction_lock, || Ok(()))
            .expect_err("poisoned transaction lock must fail closed");
        let serialized = serde_json::to_string(&error).expect("serialize lock error");

        assert_eq!(error.code, "CONFIG_TRANSACTION_LOCK_FAILED");
        assert!(!serialized.contains("panic"));
        assert!(!serialized.contains("poison"));
    }

    #[test]
    fn atomically_writes_private_v2_config() {
        use std::os::unix::fs::PermissionsExt;

        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_path = temporary_directory.path().join("settings/config.json");
        write_config_at_path(&config_path, &StoredAppConfig::default()).expect("write config");

        let raw = fs::read_to_string(&config_path).expect("read config");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("parse config");
        assert_eq!(value["schemaVersion"], CONFIG_SCHEMA_VERSION);
        assert_eq!(
            fs::metadata(config_path.parent().expect("config directory"))
                .expect("directory metadata")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&config_path)
                .expect("file metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::read_dir(config_path.parent().expect("config directory"))
                .expect("list config directory")
                .count(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn restores_original_config_when_directory_sync_fails_after_rename() {
        use std::os::unix::fs::PermissionsExt;

        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let config_directory = temporary_directory.path().join("settings");
        let config_path = config_directory.join("config.json");
        fs::create_dir_all(&config_directory).expect("create config directory");
        let original_bytes = br#"{"schemaVersion":1,"deepseek":{"apiKey":"legacy-secret"}}"#;
        fs::write(&config_path, original_bytes).expect("write original config");
        let mut sync_attempts = 0;

        let error = write_config_at_path_with_directory_sync(
            &config_path,
            &StoredAppConfig::default(),
            |directory| {
                sync_attempts += 1;
                if sync_attempts == 1 {
                    Err(io::Error::other("injected directory sync failure"))
                } else {
                    sync_directory(directory)
                }
            },
        )
        .expect_err("post-rename sync failure must fail the write");

        assert_eq!(error.code, "CONFIG_WRITE_FAILED");
        assert_eq!(
            fs::read(&config_path).expect("read restored config"),
            original_bytes
        );
        assert_eq!(sync_attempts, 2);
        assert_eq!(
            fs::metadata(&config_path)
                .expect("restored config metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::read_dir(&config_directory)
                .expect("list config directory")
                .count(),
            1
        );
    }

    #[test]
    fn new_install_disables_all_cloud_services() {
        let config = StoredAppConfig::default();

        assert!(!config.deepseek.enabled);
        assert!(!config.zhipu.enabled);
        assert!(!config.azure.enabled);
        assert_eq!(config.disclosure.accepted_version, None);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_config_file() {
        use std::os::unix::fs::symlink;

        let temporary_directory = tempfile::tempdir().expect("temporary directory");
        let target_path = temporary_directory.path().join("target.json");
        let config_path = temporary_directory.path().join("config.json");
        fs::write(&target_path, "{}").expect("write target");
        symlink(&target_path, &config_path).expect("create config symlink");

        let error = enforce_config_permissions(&config_path)
            .expect_err("symlinked config must be rejected");

        assert_eq!(error.code, "CONFIG_PATH_UNSAFE");
    }
}
