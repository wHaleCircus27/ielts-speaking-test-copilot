use crate::{read_config, AppError, StoredZhipuConfig, ZHIPU_EMBEDDING_DIMENSIONS};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const CORPUS_SQLITE_BUSY_TIMEOUT_MS: u64 = 5_000;
const CORPUS_PROVIDER_ZHIPU: &str = "zhipu";
const QUERY_EMBEDDING_CACHE_LIMIT: i64 = 200;
const ZHIPU_EMBEDDING_MAX_RETRIES: usize = 2;
const ZHIPU_EMBEDDING_INITIAL_BACKOFF_MS: u64 = 300;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeacherCaseInput {
    original_text: String,
    revised_text: String,
    teacher_comment: String,
    #[serde(default)]
    scoring_preference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EmbeddingStatus {
    Pending,
    Ready,
    Failed,
}

impl EmbeddingStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "ready" => Self::Ready,
            "failed" => Self::Failed,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeacherCase {
    id: String,
    original_text: String,
    revised_text: String,
    teacher_comment: String,
    scoring_preference: Option<String>,
    embedding_status: EmbeddingStatus,
    embedding_error: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeacherCaseMatch {
    #[serde(rename = "case")]
    r#case: TeacherCase,
    score: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeacherCaseDiagnosticMatch {
    #[serde(rename = "case")]
    r#case: TeacherCase,
    score: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum QueryEmbeddingSource {
    Cache,
    Network,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeacherCaseSearchDiagnostics {
    threshold: f64,
    top_k: u8,
    ready_candidate_count: usize,
    matched_count: usize,
    below_threshold_count: usize,
    embedding_source: QueryEmbeddingSource,
    duration_ms: u64,
    included: Vec<TeacherCaseDiagnosticMatch>,
    near_misses: Vec<TeacherCaseDiagnosticMatch>,
}

#[tauri::command]
pub(crate) async fn create_teacher_case(
    app: AppHandle,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    let teacher_case = run_corpus_blocking({
        let db_path = db_path.clone();
        move || create_teacher_case_at_path(&db_path, input)
    })
    .await?;
    rebuild_teacher_case_embedding_after_save(db_path, config.zhipu, teacher_case).await
}

#[tauri::command]
pub(crate) async fn list_teacher_cases(app: AppHandle) -> Result<Vec<TeacherCase>, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    run_corpus_blocking(move || list_teacher_cases_at_path(&db_path)).await
}

#[tauri::command]
pub(crate) async fn get_teacher_case(app: AppHandle, id: String) -> Result<TeacherCase, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    run_corpus_blocking(move || get_teacher_case_at_path(&db_path, &id)).await
}

#[tauri::command]
pub(crate) async fn update_teacher_case(
    app: AppHandle,
    id: String,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    let teacher_case = run_corpus_blocking({
        let db_path = db_path.clone();
        move || update_teacher_case_at_path(&db_path, &id, input)
    })
    .await?;
    rebuild_teacher_case_embedding_after_save(db_path, config.zhipu, teacher_case).await
}

#[tauri::command]
pub(crate) async fn delete_teacher_case(app: AppHandle, id: String) -> Result<(), AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    run_corpus_blocking(move || delete_teacher_case_at_path(&db_path, &id)).await
}

#[tauri::command]
pub(crate) async fn rebuild_teacher_case_embedding(
    app: AppHandle,
    id: String,
) -> Result<TeacherCase, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    rebuild_teacher_case_embedding_at_path(db_path, config.zhipu, id).await
}

#[tauri::command]
pub(crate) async fn search_teacher_cases(
    app: AppHandle,
    query_text: String,
    top_k: u8,
) -> Result<Vec<TeacherCaseMatch>, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    search_teacher_cases_at_path(db_path, config.zhipu, query_text, top_k).await
}

#[tauri::command]
pub(crate) async fn diagnose_teacher_case_search(
    app: AppHandle,
    query_text: String,
    top_k: u8,
    threshold_override: Option<f64>,
) -> Result<TeacherCaseSearchDiagnostics, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    diagnose_teacher_case_search_at_path(
        db_path,
        config.zhipu,
        query_text,
        top_k,
        threshold_override,
    )
    .await
}

async fn rebuild_teacher_case_embedding_at_path(
    db_path: PathBuf,
    config: StoredZhipuConfig,
    id: String,
) -> Result<TeacherCase, AppError> {
    let teacher_case = run_corpus_blocking({
        let db_path = db_path.clone();
        let id = id.clone();
        move || get_teacher_case_at_path(&db_path, &id)
    })
    .await?;
    if let Err(error) = validate_zhipu_embedding_config(&config) {
        mark_teacher_case_embedding_failed_after_error(&db_path, &teacher_case.id, &error).await?;
        return Err(error);
    }
    let embedding_text = build_teacher_case_embedding_text(&teacher_case);
    let embedding = match request_zhipu_embedding(&config, &embedding_text).await {
        Ok(embedding) => embedding,
        Err(error) => {
            mark_teacher_case_embedding_failed_after_error(&db_path, &teacher_case.id, &error)
                .await?;
            return Err(error);
        }
    };
    run_corpus_blocking(move || {
        upsert_teacher_case_embedding_and_mark_ready_at_path(
            &db_path,
            &teacher_case.id,
            &embedding,
            &config,
        )
    })
    .await
}

async fn rebuild_teacher_case_embedding_after_save(
    db_path: PathBuf,
    config: StoredZhipuConfig,
    teacher_case: TeacherCase,
) -> Result<TeacherCase, AppError> {
    if let Err(error) = validate_zhipu_embedding_config(&config) {
        if error.code == "ZHIPU_KEY_MISSING" {
            return Ok(teacher_case);
        }
        return mark_teacher_case_embedding_failed_after_error(&db_path, &teacher_case.id, &error)
            .await;
    }

    match rebuild_teacher_case_embedding_for_case(&db_path, &config, &teacher_case).await {
        Ok(updated_teacher_case) => Ok(updated_teacher_case),
        Err(error) => {
            mark_teacher_case_embedding_failed_after_error(&db_path, &teacher_case.id, &error).await
        }
    }
}

async fn rebuild_teacher_case_embedding_for_case(
    db_path: &Path,
    config: &StoredZhipuConfig,
    teacher_case: &TeacherCase,
) -> Result<TeacherCase, AppError> {
    let embedding_text = build_teacher_case_embedding_text(teacher_case);
    let embedding = request_zhipu_embedding(config, &embedding_text).await?;
    let db_path = db_path.to_path_buf();
    let case_id = teacher_case.id.clone();
    let config = config.clone();
    run_corpus_blocking(move || {
        upsert_teacher_case_embedding_and_mark_ready_at_path(
            &db_path, &case_id, &embedding, &config,
        )
    })
    .await
}

async fn mark_teacher_case_embedding_failed_after_error(
    db_path: &Path,
    case_id: &str,
    error: &AppError,
) -> Result<TeacherCase, AppError> {
    let db_path = db_path.to_path_buf();
    let case_id = case_id.to_string();
    let embedding_error = teacher_case_embedding_error_summary(error);
    run_corpus_blocking(move || {
        mark_teacher_case_embedding_failed_at_path(&db_path, &case_id, &embedding_error)
    })
    .await
}

async fn search_teacher_cases_at_path(
    db_path: PathBuf,
    config: StoredZhipuConfig,
    query_text: String,
    top_k: u8,
) -> Result<Vec<TeacherCaseMatch>, AppError> {
    let diagnostics =
        diagnose_teacher_case_search_at_path(db_path, config, query_text, top_k, None).await?;
    Ok(diagnostics
        .included
        .into_iter()
        .map(|diagnostic_match| TeacherCaseMatch {
            r#case: diagnostic_match.r#case,
            score: diagnostic_match.score,
        })
        .collect())
}

async fn diagnose_teacher_case_search_at_path(
    db_path: PathBuf,
    config: StoredZhipuConfig,
    query_text: String,
    top_k: u8,
    threshold_override: Option<f64>,
) -> Result<TeacherCaseSearchDiagnostics, AppError> {
    validate_teacher_case_search_request(&query_text, top_k)?;
    let threshold =
        validated_similarity_threshold(threshold_override.unwrap_or(config.similarity_threshold))?;
    let started_at = Instant::now();
    let (query_embedding, embedding_source) =
        get_query_embedding_with_cache(&db_path, &config, query_text.trim()).await?;

    let mut diagnostics = run_corpus_blocking({
        let db_path = db_path.clone();
        let config = config.clone();
        move || {
            build_teacher_case_search_diagnostics(
                &db_path,
                &config,
                &query_embedding,
                top_k,
                threshold,
                embedding_source,
                Duration::ZERO,
            )
        }
    })
    .await?;
    diagnostics.duration_ms = u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(diagnostics)
}

fn filter_and_rank_teacher_case_matches(
    mut matches: Vec<(String, f64)>,
    top_k: u8,
    threshold: f64,
) -> Vec<(String, f64)> {
    matches.retain(|(_, score)| *score >= threshold);
    matches.sort_by(|left, right| right.1.total_cmp(&left.1));
    matches.truncate(top_k as usize);
    matches
}

async fn get_query_embedding_with_cache(
    db_path: &Path,
    config: &StoredZhipuConfig,
    query_text: &str,
) -> Result<(Vec<f64>, QueryEmbeddingSource), AppError> {
    let normalized_query = normalize_query_text_for_cache(query_text);
    let query_hash = build_query_embedding_cache_hash(config, &normalized_query);
    let cached_embedding = run_corpus_blocking({
        let db_path = db_path.to_path_buf();
        let config = config.clone();
        let query_hash = query_hash.clone();
        move || read_query_embedding_cache_at_path(&db_path, &config, &query_hash)
    })
    .await?;

    if let Some(embedding) = cached_embedding {
        return Ok((embedding, QueryEmbeddingSource::Cache));
    }

    let embedding = request_zhipu_embedding(config, &normalized_query).await?;
    run_corpus_blocking({
        let db_path = db_path.to_path_buf();
        let config = config.clone();
        let query_hash = query_hash.clone();
        let embedding = embedding.clone();
        move || upsert_query_embedding_cache_at_path(&db_path, &config, &query_hash, &embedding)
    })
    .await?;

    Ok((embedding, QueryEmbeddingSource::Network))
}

fn build_teacher_case_search_diagnostics(
    db_path: &Path,
    config: &StoredZhipuConfig,
    query_embedding: &[f64],
    top_k: u8,
    threshold: f64,
    embedding_source: QueryEmbeddingSource,
    duration: Duration,
) -> Result<TeacherCaseSearchDiagnostics, AppError> {
    let stored_embeddings = list_ready_teacher_case_embeddings_at_path(db_path, config)?;
    let ready_candidate_count = stored_embeddings.len();
    let scored_matches = stored_embeddings
        .into_iter()
        .filter(|stored_embedding| stored_embedding.embedding.len() == query_embedding.len())
        .filter_map(|stored_embedding| {
            let score = cosine_similarity(query_embedding, &stored_embedding.embedding)?;
            Some((stored_embedding.case_id, score))
        })
        .collect::<Vec<_>>();
    let below_threshold_count = scored_matches
        .iter()
        .filter(|(_, score)| *score < threshold)
        .count();
    let included_scores =
        filter_and_rank_teacher_case_matches(scored_matches.clone(), top_k, threshold);
    let mut near_miss_scores = scored_matches
        .into_iter()
        .filter(|(_, score)| *score < threshold)
        .collect::<Vec<_>>();
    near_miss_scores.sort_by(|left, right| right.1.total_cmp(&left.1));
    near_miss_scores.truncate(top_k as usize);

    let connection = open_corpus_connection(db_path)?;
    let included = diagnostic_matches_from_scores(&connection, included_scores)?;
    let near_misses = diagnostic_matches_from_scores(&connection, near_miss_scores)?;
    let duration_ms = u64::try_from(duration.as_millis()).unwrap_or(u64::MAX);

    Ok(TeacherCaseSearchDiagnostics {
        threshold,
        top_k,
        ready_candidate_count,
        matched_count: included.len(),
        below_threshold_count,
        embedding_source,
        duration_ms,
        included,
        near_misses,
    })
}

fn diagnostic_matches_from_scores(
    connection: &Connection,
    scores: Vec<(String, f64)>,
) -> Result<Vec<TeacherCaseDiagnosticMatch>, AppError> {
    scores
        .into_iter()
        .map(|(case_id, score)| {
            let teacher_case = select_teacher_case_by_id(connection, &case_id)?
                .ok_or_else(|| AppError::new("CORPUS_CASE_NOT_FOUND", "未找到指定教师案例。"))?;
            Ok(TeacherCaseDiagnosticMatch {
                r#case: teacher_case,
                score,
            })
        })
        .collect()
}

fn validated_similarity_threshold(value: f64) -> Result<f64, AppError> {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        Ok(value)
    } else {
        Err(AppError::new(
            "CORPUS_SEARCH_THRESHOLD_INVALID",
            "教师案例 RAG 相似度阈值必须在 0.0-1.0 之间。",
        ))
    }
}

fn normalize_query_text_for_cache(query_text: &str) -> String {
    query_text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn build_query_embedding_cache_hash(config: &StoredZhipuConfig, normalized_query: &str) -> String {
    let mut hasher = Sha256::new();
    let dimensions = config.dimensions.to_string();
    for part in [
        CORPUS_PROVIDER_ZHIPU,
        config.model.trim(),
        dimensions.as_str(),
        normalized_query,
    ] {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn run_corpus_blocking<T, F>(operation: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_BLOCKING_TASK_FAILED",
                "教师案例库后台任务执行失败。",
                error.to_string(),
            )
        })?
}

fn validate_teacher_case_search_request(query_text: &str, top_k: u8) -> Result<(), AppError> {
    if query_text.trim().is_empty() {
        return Err(AppError::new(
            "CORPUS_SEARCH_QUERY_EMPTY",
            "检索文本不能为空。",
        ));
    }

    if top_k == 0 || top_k > 3 {
        return Err(AppError::new(
            "CORPUS_SEARCH_TOP_K_INVALID",
            "教师案例检索数量必须在 1-3 之间。",
        ));
    }

    Ok(())
}

fn teacher_cases_db_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app.path().app_data_dir().map_err(|error| {
        AppError::with_detail(
            "CORPUS_DB_PATH_FAILED",
            "无法定位教师案例库目录。",
            error.to_string(),
        )
    })?;

    Ok(dir.join("teacher-cases.sqlite3"))
}

fn initialize_teacher_cases_schema(db_path: &Path) -> Result<(), AppError> {
    if let Some(parent_dir) = db_path.parent() {
        fs::create_dir_all(parent_dir).map_err(|error| {
            AppError::with_detail(
                "CORPUS_DB_INIT_FAILED",
                "创建教师案例库目录失败。",
                error.to_string(),
            )
        })?;
    }

    let connection = open_corpus_connection(db_path)?;
    match detect_corpus_schema_state(&connection)? {
        CorpusSchemaState::Empty => create_current_corpus_schema(&connection),
        CorpusSchemaState::Current => ensure_current_corpus_schema(&connection),
        CorpusSchemaState::Legacy => {
            drop(connection);
            migrate_legacy_corpus_database(db_path)
        }
    }
}

fn open_corpus_connection(db_path: &Path) -> Result<Connection, AppError> {
    let connection = Connection::open(db_path).map_err(|error| {
        AppError::with_detail(
            "CORPUS_SQLITE_OPEN_FAILED",
            "打开教师案例库失败。",
            error.to_string(),
        )
    })?;
    connection
        .busy_timeout(Duration::from_millis(CORPUS_SQLITE_BUSY_TIMEOUT_MS))
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SQLITE_PRAGMA_FAILED",
                "设置教师案例库 busy_timeout 失败。",
                error.to_string(),
            )
        })?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SQLITE_PRAGMA_FAILED",
                "启用教师案例库外键约束失败。",
                error.to_string(),
            )
        })?;

    Ok(connection)
}

fn create_current_corpus_schema(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            r#"
        CREATE TABLE IF NOT EXISTS teacher_cases (
            id TEXT PRIMARY KEY NOT NULL,
            original_text TEXT NOT NULL,
            revised_text TEXT NOT NULL,
            teacher_comment TEXT NOT NULL,
            scoring_preference TEXT,
            embedding_status TEXT NOT NULL DEFAULT 'pending',
            embedding_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_cases_updated_at
            ON teacher_cases(updated_at DESC);
        CREATE TABLE IF NOT EXISTS teacher_case_embeddings (
            case_id TEXT PRIMARY KEY NOT NULL,
            embedding_blob BLOB NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(case_id) REFERENCES teacher_cases(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS teacher_case_query_embeddings (
            query_hash TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding_blob BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            PRIMARY KEY(query_hash, provider, model, dimensions)
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_case_query_embeddings_lru
            ON teacher_case_query_embeddings(provider, model, dimensions, last_used_at ASC);
        "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SCHEMA_INIT_FAILED",
                "初始化教师案例库表结构失败。",
                error.to_string(),
            )
        })
}

fn ensure_current_corpus_schema(connection: &Connection) -> Result<(), AppError> {
    create_current_corpus_schema(connection)?;
    let teacher_case_columns = table_columns(connection, "teacher_cases")?;
    if !column_exists(&teacher_case_columns, "embedding_error") {
        connection
            .execute(
                "ALTER TABLE teacher_cases ADD COLUMN embedding_error TEXT;",
                [],
            )
            .map_err(|error| {
                AppError::with_detail(
                    "CORPUS_SCHEMA_MIGRATION_FAILED",
                    "补充教师案例库失败原因字段失败。",
                    error.to_string(),
                )
            })?;
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum CorpusSchemaState {
    Empty,
    Current,
    Legacy,
}

#[derive(Debug)]
struct TableColumn {
    name: String,
    declared_type: String,
}

fn detect_corpus_schema_state(connection: &Connection) -> Result<CorpusSchemaState, AppError> {
    let teacher_cases_exists = table_exists(connection, "teacher_cases")?;
    let embeddings_exists = table_exists(connection, "teacher_case_embeddings")?;
    if !teacher_cases_exists && !embeddings_exists {
        return Ok(CorpusSchemaState::Empty);
    }

    let teacher_case_columns = table_columns(connection, "teacher_cases")?;
    let embedding_columns = table_columns(connection, "teacher_case_embeddings")?;
    let current_teacher_cases = column_type_is(&teacher_case_columns, "created_at", "INTEGER")
        && column_type_is(&teacher_case_columns, "updated_at", "INTEGER");
    let current_embeddings =
        !embeddings_exists || column_exists(&embedding_columns, "embedding_blob");

    if current_teacher_cases && current_embeddings {
        Ok(CorpusSchemaState::Current)
    } else {
        Ok(CorpusSchemaState::Legacy)
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, AppError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1);",
            params![table_name],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value == 1)
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SCHEMA_READ_FAILED",
                "读取教师案例库表结构失败。",
                error.to_string(),
            )
        })
}

fn table_columns(connection: &Connection, table_name: &str) -> Result<Vec<TableColumn>, AppError> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name});"))
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SCHEMA_READ_FAILED",
                "读取教师案例库字段结构失败。",
                error.to_string(),
            )
        })?;

    let columns = statement
        .query_map([], |row| {
            Ok(TableColumn {
                name: row.get(1)?,
                declared_type: row.get(2)?,
            })
        })
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SCHEMA_READ_FAILED",
                "读取教师案例库字段结构失败。",
                error.to_string(),
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SCHEMA_READ_FAILED",
                "解析教师案例库字段结构失败。",
                error.to_string(),
            )
        })?;

    Ok(columns)
}

fn column_exists(columns: &[TableColumn], column_name: &str) -> bool {
    columns.iter().any(|column| column.name == column_name)
}

fn column_type_is(columns: &[TableColumn], column_name: &str, expected_type: &str) -> bool {
    columns.iter().any(|column| {
        column.name == column_name && column.declared_type.eq_ignore_ascii_case(expected_type)
    })
}

#[derive(Debug)]
struct LegacyTeacherCaseRow {
    id: String,
    original_text: String,
    revised_text: String,
    teacher_comment: String,
    scoring_preference: Option<String>,
    embedding_status: EmbeddingStatus,
    embedding_error: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug)]
struct LegacyTeacherCaseEmbeddingRow {
    case_id: String,
    embedding_blob: Vec<u8>,
    provider: String,
    model: String,
    dimensions: u16,
    updated_at: i64,
}

fn migrate_legacy_corpus_database(db_path: &Path) -> Result<(), AppError> {
    let migration_timestamp = timestamp_millis();
    let backup_path = migration_sidecar_path(db_path, "backup", migration_timestamp);
    fs::copy(db_path, &backup_path).map_err(|error| {
        AppError::with_detail(
            "CORPUS_DB_BACKUP_FAILED",
            "备份旧教师案例库失败。",
            error.to_string(),
        )
    })?;

    let temp_path = migration_sidecar_path(db_path, "migrating", migration_timestamp);
    let migration_result = (|| {
        let legacy_connection = open_corpus_connection(db_path)?;
        let teacher_cases = read_legacy_teacher_cases(&legacy_connection)?;
        let embeddings = read_legacy_teacher_case_embeddings(&legacy_connection)?;
        drop(legacy_connection);

        let mut migrated_connection = open_corpus_connection(&temp_path)?;
        create_current_corpus_schema(&migrated_connection)?;
        let transaction = migrated_connection.transaction().map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_FAILED",
                "教师案例库迁移事务启动失败。",
                error.to_string(),
            )
        })?;
        insert_legacy_teacher_cases(&transaction, &teacher_cases)?;
        insert_legacy_teacher_case_embeddings(&transaction, &embeddings)?;
        transaction.commit().map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_FAILED",
                "教师案例库迁移提交失败。",
                error.to_string(),
            )
        })?;
        drop(migrated_connection);

        fs::rename(&temp_path, db_path).map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_REPLACE_FAILED",
                format!(
                    "教师案例库迁移已生成备份 {}，但替换原库失败。",
                    backup_path.display()
                ),
                error.to_string(),
            )
        })
    })();

    if migration_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }

    migration_result
}

fn migration_sidecar_path(db_path: &Path, label: &str, timestamp: i64) -> PathBuf {
    let file_name = db_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("teacher-cases.sqlite3");
    db_path.with_file_name(format!("{file_name}.{label}-{timestamp}"))
}

fn read_legacy_teacher_cases(
    connection: &Connection,
) -> Result<Vec<LegacyTeacherCaseRow>, AppError> {
    let teacher_case_columns = table_columns(connection, "teacher_cases")?;
    let embedding_error_projection = if column_exists(&teacher_case_columns, "embedding_error") {
        "embedding_error"
    } else {
        "NULL AS embedding_error"
    };
    let mut statement = connection
        .prepare(&format!(
            r#"
            SELECT
                id,
                original_text,
                revised_text,
                teacher_comment,
                scoring_preference,
                embedding_status,
                {embedding_error_projection},
                CAST(created_at AS TEXT),
                CAST(updated_at AS TEXT)
            FROM teacher_cases
            ORDER BY updated_at DESC, created_at DESC;
            "#,
        ))
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例失败。",
                error.to_string(),
            )
        })?;

    let teacher_cases = statement
        .query_map([], |row| {
            let created_at: String = row.get(7)?;
            let updated_at: String = row.get(8)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                created_at,
                updated_at,
            ))
        })
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例失败。",
                error.to_string(),
            )
        })?
        .map(|row_result| {
            let (
                id,
                original_text,
                revised_text,
                teacher_comment,
                scoring_preference,
                embedding_status,
                embedding_error,
                created_at,
                updated_at,
            ) = row_result.map_err(|error| {
                AppError::with_detail(
                    "CORPUS_MIGRATION_READ_FAILED",
                    "解析旧教师案例失败。",
                    error.to_string(),
                )
            })?;

            Ok(LegacyTeacherCaseRow {
                id,
                original_text,
                revised_text,
                teacher_comment,
                scoring_preference: scoring_preference
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                embedding_status: EmbeddingStatus::from_str(&embedding_status),
                embedding_error: embedding_error
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty()),
                created_at: parse_legacy_timestamp_millis(&created_at)?,
                updated_at: parse_legacy_timestamp_millis(&updated_at)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(teacher_cases)
}

fn read_legacy_teacher_case_embeddings(
    connection: &Connection,
) -> Result<Vec<LegacyTeacherCaseEmbeddingRow>, AppError> {
    if !table_exists(connection, "teacher_case_embeddings")? {
        return Ok(Vec::new());
    }

    let embedding_columns = table_columns(connection, "teacher_case_embeddings")?;
    if column_exists(&embedding_columns, "embedding_blob") {
        read_blob_teacher_case_embeddings(connection)
    } else {
        read_json_teacher_case_embeddings(connection)
    }
}

fn read_blob_teacher_case_embeddings(
    connection: &Connection,
) -> Result<Vec<LegacyTeacherCaseEmbeddingRow>, AppError> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT case_id, embedding_blob, provider, model, dimensions, CAST(updated_at AS TEXT)
            FROM teacher_case_embeddings;
            "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例向量失败。",
                error.to_string(),
            )
        })?;

    let embeddings = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例向量失败。",
                error.to_string(),
            )
        })?
        .map(|row_result| {
            let (case_id, embedding_blob, provider, model, dimensions, updated_at) = row_result
                .map_err(|error| {
                    AppError::with_detail(
                        "CORPUS_MIGRATION_READ_FAILED",
                        "解析旧教师案例向量失败。",
                        error.to_string(),
                    )
                })?;
            Ok(LegacyTeacherCaseEmbeddingRow {
                case_id,
                embedding_blob,
                provider,
                model,
                dimensions: u16::try_from(dimensions).unwrap_or_default(),
                updated_at: parse_legacy_timestamp_millis(&updated_at)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(embeddings)
}

fn read_json_teacher_case_embeddings(
    connection: &Connection,
) -> Result<Vec<LegacyTeacherCaseEmbeddingRow>, AppError> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT case_id, embedding_json, provider, model, dimensions, CAST(updated_at AS TEXT)
            FROM teacher_case_embeddings;
            "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例 JSON 向量失败。",
                error.to_string(),
            )
        })?;

    let embeddings = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_READ_FAILED",
                "读取旧教师案例 JSON 向量失败。",
                error.to_string(),
            )
        })?
        .map(|row_result| {
            let (case_id, embedding_json, provider, model, dimensions, updated_at) = row_result
                .map_err(|error| {
                    AppError::with_detail(
                        "CORPUS_MIGRATION_READ_FAILED",
                        "解析旧教师案例 JSON 向量失败。",
                        error.to_string(),
                    )
                })?;
            let embedding = serde_json::from_str::<Vec<f64>>(&embedding_json).map_err(|error| {
                AppError::with_detail(
                    "CORPUS_MIGRATION_READ_FAILED",
                    "解析旧教师案例 JSON 向量内容失败。",
                    error.to_string(),
                )
            })?;

            Ok(LegacyTeacherCaseEmbeddingRow {
                case_id,
                embedding_blob: encode_embedding_blob(&embedding)?,
                provider,
                model,
                dimensions: u16::try_from(dimensions).unwrap_or_default(),
                updated_at: parse_legacy_timestamp_millis(&updated_at)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(embeddings)
}

fn insert_legacy_teacher_cases(
    transaction: &Transaction<'_>,
    teacher_cases: &[LegacyTeacherCaseRow],
) -> Result<(), AppError> {
    let mut statement = transaction
        .prepare(
            r#"
            INSERT INTO teacher_cases (
                id,
                original_text,
                revised_text,
                teacher_comment,
                scoring_preference,
                embedding_status,
                embedding_error,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9);
            "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_FAILED",
                "准备迁移教师案例失败。",
                error.to_string(),
            )
        })?;

    for teacher_case in teacher_cases {
        statement
            .execute(params![
                teacher_case.id,
                teacher_case.original_text,
                teacher_case.revised_text,
                teacher_case.teacher_comment,
                teacher_case.scoring_preference,
                teacher_case.embedding_status.as_str(),
                teacher_case.embedding_error,
                teacher_case.created_at,
                teacher_case.updated_at
            ])
            .map_err(|error| {
                AppError::with_detail(
                    "CORPUS_MIGRATION_FAILED",
                    "迁移教师案例失败。",
                    error.to_string(),
                )
            })?;
    }

    Ok(())
}

fn insert_legacy_teacher_case_embeddings(
    transaction: &Transaction<'_>,
    embeddings: &[LegacyTeacherCaseEmbeddingRow],
) -> Result<(), AppError> {
    let mut statement = transaction
        .prepare(
            r#"
            INSERT INTO teacher_case_embeddings (
                case_id,
                embedding_blob,
                provider,
                model,
                dimensions,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);
            "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_MIGRATION_FAILED",
                "准备迁移教师案例向量失败。",
                error.to_string(),
            )
        })?;

    for embedding in embeddings {
        statement
            .execute(params![
                embedding.case_id,
                embedding.embedding_blob,
                embedding.provider,
                embedding.model,
                embedding.dimensions,
                embedding.updated_at
            ])
            .map_err(|error| {
                AppError::with_detail(
                    "CORPUS_MIGRATION_FAILED",
                    "迁移教师案例向量失败。",
                    error.to_string(),
                )
            })?;
    }

    Ok(())
}

fn parse_legacy_timestamp_millis(value: &str) -> Result<i64, AppError> {
    let parsed = value.trim().parse::<i128>().map_err(|error| {
        AppError::with_detail(
            "CORPUS_MIGRATION_TIMESTAMP_INVALID",
            "旧教师案例库时间戳无法迁移。",
            error.to_string(),
        )
    })?;

    let millis = if parsed > 10_000_000_000_000 {
        parsed / 1_000_000
    } else {
        parsed
    };

    i64::try_from(millis).map_err(|error| {
        AppError::with_detail(
            "CORPUS_MIGRATION_TIMESTAMP_INVALID",
            "旧教师案例库时间戳超出可迁移范围。",
            error.to_string(),
        )
    })
}

fn create_teacher_case_at_path(
    db_path: &Path,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let normalized_input = normalize_teacher_case_input(input)?;
    let now = timestamp_millis();
    let teacher_case = TeacherCase {
        id: generate_teacher_case_id(),
        original_text: normalized_input.original_text,
        revised_text: normalized_input.revised_text,
        teacher_comment: normalized_input.teacher_comment,
        scoring_preference: normalized_input.scoring_preference,
        embedding_status: EmbeddingStatus::Pending,
        embedding_error: None,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    };

    let connection = open_corpus_connection(db_path)?;
    connection
        .execute(
            r#"
        INSERT INTO teacher_cases (
            id,
            original_text,
            revised_text,
            teacher_comment,
            scoring_preference,
            embedding_status,
            embedding_error,
            created_at,
            updated_at
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            ?7,
            ?8,
            ?9
        );
        "#,
            params![
                teacher_case.id,
                teacher_case.original_text,
                teacher_case.revised_text,
                teacher_case.teacher_comment,
                teacher_case.scoring_preference,
                teacher_case.embedding_status.as_str(),
                teacher_case.embedding_error,
                now,
                now
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_CREATE_FAILED",
                "保存教师案例失败。",
                error.to_string(),
            )
        })?;

    get_teacher_case_at_path(db_path, &teacher_case.id)
}

fn list_teacher_cases_at_path(db_path: &Path) -> Result<Vec<TeacherCase>, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    let mut statement = connection
        .prepare(
            r#"
        SELECT
            id,
            original_text,
            revised_text,
            teacher_comment,
            scoring_preference,
            embedding_status,
            embedding_error,
            created_at,
            updated_at
        FROM teacher_cases
        ORDER BY updated_at DESC, created_at DESC;
        "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_LIST_FAILED",
                "读取教师案例列表失败。",
                error.to_string(),
            )
        })?;

    let teacher_cases = statement
        .query_map([], row_to_teacher_case)
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_LIST_FAILED",
                "读取教师案例列表失败。",
                error.to_string(),
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_LIST_FAILED",
                "解析教师案例列表失败。",
                error.to_string(),
            )
        })?;

    Ok(teacher_cases)
}

fn get_teacher_case_at_path(db_path: &Path, id: &str) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    select_teacher_case_by_id(&connection, id)?
        .ok_or_else(|| AppError::new("CORPUS_CASE_NOT_FOUND", "未找到指定教师案例。"))
}

fn select_teacher_case_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<TeacherCase>, AppError> {
    connection
        .query_row(
            r#"
        SELECT
            id,
            original_text,
            revised_text,
            teacher_comment,
            scoring_preference,
            embedding_status,
            embedding_error,
            created_at,
            updated_at
        FROM teacher_cases
        WHERE id = ?1;
        "#,
            params![id.trim()],
            row_to_teacher_case,
        )
        .optional()
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_READ_FAILED",
                "读取教师案例失败。",
                error.to_string(),
            )
        })
}

fn update_teacher_case_at_path(
    db_path: &Path,
    id: &str,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let mut connection = open_corpus_connection(db_path)?;
    if select_teacher_case_by_id(&connection, id)?.is_none() {
        return Err(AppError::new(
            "CORPUS_CASE_NOT_FOUND",
            "未找到指定教师案例。",
        ));
    }
    let normalized_input = normalize_teacher_case_input(input)?;
    let updated_at = timestamp_millis();

    let transaction = connection.transaction().map_err(|error| {
        AppError::with_detail(
            "CORPUS_CASE_UPDATE_FAILED",
            "教师案例更新事务启动失败。",
            error.to_string(),
        )
    })?;
    transaction
        .execute(
            r#"
        UPDATE teacher_cases
        SET
            original_text = ?1,
            revised_text = ?2,
            teacher_comment = ?3,
            scoring_preference = ?4,
            embedding_status = 'pending',
            embedding_error = NULL,
            updated_at = ?5
        WHERE id = ?6;
        "#,
            params![
                normalized_input.original_text,
                normalized_input.revised_text,
                normalized_input.teacher_comment,
                normalized_input.scoring_preference,
                updated_at,
                id.trim()
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_UPDATE_FAILED",
                "更新教师案例失败。",
                error.to_string(),
            )
        })?;
    delete_teacher_case_embedding_in_transaction(&transaction, id)?;
    transaction.commit().map_err(|error| {
        AppError::with_detail(
            "CORPUS_CASE_UPDATE_FAILED",
            "教师案例更新事务提交失败。",
            error.to_string(),
        )
    })?;

    get_teacher_case_at_path(db_path, id)
}

fn delete_teacher_case_at_path(db_path: &Path, id: &str) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let mut connection = open_corpus_connection(db_path)?;
    if select_teacher_case_by_id(&connection, id)?.is_none() {
        return Err(AppError::new(
            "CORPUS_CASE_NOT_FOUND",
            "未找到指定教师案例。",
        ));
    }
    let transaction = connection.transaction().map_err(|error| {
        AppError::with_detail(
            "CORPUS_CASE_DELETE_FAILED",
            "教师案例删除事务启动失败。",
            error.to_string(),
        )
    })?;
    delete_teacher_case_embedding_in_transaction(&transaction, id)?;
    transaction
        .execute(
            "DELETE FROM teacher_cases WHERE id = ?1;",
            params![id.trim()],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_CASE_DELETE_FAILED",
                "删除教师案例失败。",
                error.to_string(),
            )
        })?;
    transaction.commit().map_err(|error| {
        AppError::with_detail(
            "CORPUS_CASE_DELETE_FAILED",
            "教师案例删除事务提交失败。",
            error.to_string(),
        )
    })?;
    Ok(())
}

#[cfg(test)]
fn set_teacher_case_embedding_status_at_path(
    db_path: &Path,
    id: &str,
    embedding_status: EmbeddingStatus,
) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    set_teacher_case_embedding_status(&connection, id, embedding_status)
}

#[cfg(test)]
fn set_teacher_case_embedding_status(
    connection: &Connection,
    id: &str,
    embedding_status: EmbeddingStatus,
) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE teacher_cases SET embedding_status = ?1, embedding_error = NULL, updated_at = ?2 WHERE id = ?3;",
            params![embedding_status.as_str(), timestamp_millis(), id.trim()],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STATUS_FAILED",
                "更新教师案例 Embedding 状态失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

#[cfg(test)]
fn upsert_teacher_case_embedding_at_path(
    db_path: &Path,
    case_id: &str,
    embedding: &[f64],
    config: &StoredZhipuConfig,
) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    upsert_teacher_case_embedding(&connection, case_id, embedding, config)
}

fn upsert_teacher_case_embedding_and_mark_ready_at_path(
    db_path: &Path,
    case_id: &str,
    embedding: &[f64],
    config: &StoredZhipuConfig,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let mut connection = open_corpus_connection(db_path)?;
    if select_teacher_case_by_id(&connection, case_id)?.is_none() {
        return Err(AppError::new(
            "CORPUS_CASE_NOT_FOUND",
            "未找到指定教师案例。",
        ));
    }

    let transaction = connection.transaction().map_err(|error| {
        AppError::with_detail(
            "CORPUS_EMBEDDING_STORE_FAILED",
            "教师案例向量写入事务启动失败。",
            error.to_string(),
        )
    })?;
    upsert_teacher_case_embedding_in_transaction(&transaction, case_id, embedding, config)?;
    transaction
        .execute(
            "UPDATE teacher_cases SET embedding_status = ?1, embedding_error = NULL, updated_at = ?2 WHERE id = ?3;",
            params![
                EmbeddingStatus::Ready.as_str(),
                timestamp_millis(),
                case_id.trim()
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STATUS_FAILED",
                "更新教师案例 Embedding 状态失败。",
                error.to_string(),
            )
        })?;
    transaction.commit().map_err(|error| {
        AppError::with_detail(
            "CORPUS_EMBEDDING_STORE_FAILED",
            "教师案例向量写入事务提交失败。",
            error.to_string(),
        )
    })?;

    get_teacher_case_at_path(db_path, case_id)
}

#[cfg(test)]
fn upsert_teacher_case_embedding(
    connection: &Connection,
    case_id: &str,
    embedding: &[f64],
    config: &StoredZhipuConfig,
) -> Result<(), AppError> {
    let mut statement = connection
        .prepare(
            r#"
        INSERT INTO teacher_case_embeddings (
            case_id,
            embedding_blob,
            provider,
            model,
            dimensions,
            updated_at
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6
        )
        ON CONFLICT(case_id) DO UPDATE SET
            embedding_blob = excluded.embedding_blob,
            provider = excluded.provider,
            model = excluded.model,
            dimensions = excluded.dimensions,
            updated_at = excluded.updated_at;
        "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STORE_FAILED",
                "准备写入教师案例向量失败。",
                error.to_string(),
            )
        })?;
    let embedding_blob = encode_embedding_blob(embedding)?;
    statement
        .execute(params![
            case_id.trim(),
            embedding_blob,
            CORPUS_PROVIDER_ZHIPU,
            config.model,
            config.dimensions,
            timestamp_millis()
        ])
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STORE_FAILED",
                "写入教师案例向量失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

fn upsert_teacher_case_embedding_in_transaction(
    transaction: &Transaction<'_>,
    case_id: &str,
    embedding: &[f64],
    config: &StoredZhipuConfig,
) -> Result<(), AppError> {
    let embedding_blob = encode_embedding_blob(embedding)?;
    transaction
        .execute(
            r#"
        INSERT INTO teacher_case_embeddings (
            case_id,
            embedding_blob,
            provider,
            model,
            dimensions,
            updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(case_id) DO UPDATE SET
            embedding_blob = excluded.embedding_blob,
            provider = excluded.provider,
            model = excluded.model,
            dimensions = excluded.dimensions,
            updated_at = excluded.updated_at;
        "#,
            params![
                case_id.trim(),
                embedding_blob,
                CORPUS_PROVIDER_ZHIPU,
                config.model,
                config.dimensions,
                timestamp_millis()
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STORE_FAILED",
                "写入教师案例向量失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

#[cfg(test)]
fn delete_teacher_case_embedding_at_path(db_path: &Path, case_id: &str) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    connection
        .execute(
            "DELETE FROM teacher_case_embeddings WHERE case_id = ?1;",
            params![case_id.trim()],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_DELETE_FAILED",
                "删除教师案例向量失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

fn delete_teacher_case_embedding_in_transaction(
    transaction: &Transaction<'_>,
    case_id: &str,
) -> Result<(), AppError> {
    transaction
        .execute(
            "DELETE FROM teacher_case_embeddings WHERE case_id = ?1;",
            params![case_id.trim()],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_DELETE_FAILED",
                "删除教师案例向量失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

fn mark_teacher_case_embedding_failed_at_path(
    db_path: &Path,
    case_id: &str,
    embedding_error: &str,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    let updated_rows = connection
        .execute(
            r#"
            UPDATE teacher_cases
            SET embedding_status = ?1,
                embedding_error = ?2,
                updated_at = ?3
            WHERE id = ?4;
            "#,
            params![
                EmbeddingStatus::Failed.as_str(),
                embedding_error.trim(),
                timestamp_millis(),
                case_id.trim()
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_STATUS_FAILED",
                "记录教师案例 Embedding 失败状态失败。",
                error.to_string(),
            )
        })?;

    if updated_rows == 0 {
        return Err(AppError::new(
            "CORPUS_CASE_NOT_FOUND",
            "未找到指定教师案例。",
        ));
    }

    get_teacher_case_at_path(db_path, case_id)
}

#[derive(Debug)]
struct StoredTeacherCaseEmbedding {
    case_id: String,
    embedding: Vec<f64>,
}

fn list_ready_teacher_case_embeddings_at_path(
    db_path: &Path,
    config: &StoredZhipuConfig,
) -> Result<Vec<StoredTeacherCaseEmbedding>, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    let mut statement = connection
        .prepare(
            r#"
        SELECT
            teacher_case_embeddings.case_id,
            teacher_case_embeddings.embedding_blob
        FROM teacher_case_embeddings
        INNER JOIN teacher_cases ON teacher_cases.id = teacher_case_embeddings.case_id
        WHERE teacher_cases.embedding_status = 'ready'
            AND teacher_case_embeddings.provider = ?1
            AND teacher_case_embeddings.model = ?2
            AND teacher_case_embeddings.dimensions = ?3;
        "#,
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_READ_FAILED",
                "准备读取教师案例向量失败。",
                error.to_string(),
            )
        })?;

    let embeddings = statement
        .query_map(
            params![CORPUS_PROVIDER_ZHIPU, config.model, config.dimensions],
            |row| {
                let case_id: String = row.get(0)?;
                let embedding_blob: Vec<u8> = row.get(1)?;
                Ok((case_id, embedding_blob))
            },
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_EMBEDDING_READ_FAILED",
                "读取教师案例向量失败。",
                error.to_string(),
            )
        })?
        .map(|row_result| {
            let (case_id, embedding_blob) = row_result.map_err(|error| {
                AppError::with_detail(
                    "CORPUS_EMBEDDING_READ_FAILED",
                    "解析教师案例向量记录失败。",
                    error.to_string(),
                )
            })?;
            Ok(StoredTeacherCaseEmbedding {
                case_id,
                embedding: decode_embedding_blob(&embedding_blob)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;

    Ok(embeddings)
}

fn read_query_embedding_cache_at_path(
    db_path: &Path,
    config: &StoredZhipuConfig,
    query_hash: &str,
) -> Result<Option<Vec<f64>>, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let connection = open_corpus_connection(db_path)?;
    let embedding_blob = connection
        .query_row(
            r#"
            SELECT embedding_blob
            FROM teacher_case_query_embeddings
            WHERE query_hash = ?1
                AND provider = ?2
                AND model = ?3
                AND dimensions = ?4;
            "#,
            params![
                query_hash.trim(),
                CORPUS_PROVIDER_ZHIPU,
                config.model.trim(),
                config.dimensions
            ],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_QUERY_EMBEDDING_CACHE_READ_FAILED",
                "读取教师案例检索向量缓存失败。",
                error.to_string(),
            )
        })?;

    if let Some(blob) = embedding_blob {
        connection
            .execute(
                r#"
                UPDATE teacher_case_query_embeddings
                SET last_used_at = ?1
                WHERE query_hash = ?2
                    AND provider = ?3
                    AND model = ?4
                    AND dimensions = ?5;
                "#,
                params![
                    timestamp_millis(),
                    query_hash.trim(),
                    CORPUS_PROVIDER_ZHIPU,
                    config.model.trim(),
                    config.dimensions
                ],
            )
            .map_err(|error| {
                AppError::with_detail(
                    "CORPUS_QUERY_EMBEDDING_CACHE_UPDATE_FAILED",
                    "更新教师案例检索向量缓存时间失败。",
                    error.to_string(),
                )
            })?;
        return decode_embedding_blob(&blob).map(Some);
    }

    Ok(None)
}

fn upsert_query_embedding_cache_at_path(
    db_path: &Path,
    config: &StoredZhipuConfig,
    query_hash: &str,
    embedding: &[f64],
) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let mut connection = open_corpus_connection(db_path)?;
    let transaction = connection.transaction().map_err(|error| {
        AppError::with_detail(
            "CORPUS_QUERY_EMBEDDING_CACHE_WRITE_FAILED",
            "教师案例检索向量缓存事务启动失败。",
            error.to_string(),
        )
    })?;
    let now = timestamp_millis();
    let embedding_blob = encode_embedding_blob(embedding)?;
    transaction
        .execute(
            r#"
            INSERT INTO teacher_case_query_embeddings (
                query_hash,
                provider,
                model,
                dimensions,
                embedding_blob,
                created_at,
                last_used_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(query_hash, provider, model, dimensions)
            DO UPDATE SET
                embedding_blob = excluded.embedding_blob,
                last_used_at = excluded.last_used_at;
            "#,
            params![
                query_hash.trim(),
                CORPUS_PROVIDER_ZHIPU,
                config.model.trim(),
                config.dimensions,
                embedding_blob,
                now,
                now
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_QUERY_EMBEDDING_CACHE_WRITE_FAILED",
                "写入教师案例检索向量缓存失败。",
                error.to_string(),
            )
        })?;
    prune_query_embedding_cache_in_transaction(&transaction, config)?;
    transaction.commit().map_err(|error| {
        AppError::with_detail(
            "CORPUS_QUERY_EMBEDDING_CACHE_WRITE_FAILED",
            "教师案例检索向量缓存事务提交失败。",
            error.to_string(),
        )
    })?;
    Ok(())
}

fn prune_query_embedding_cache_in_transaction(
    transaction: &Transaction<'_>,
    config: &StoredZhipuConfig,
) -> Result<(), AppError> {
    transaction
        .execute(
            r#"
            DELETE FROM teacher_case_query_embeddings
            WHERE rowid IN (
                SELECT rowid
                FROM teacher_case_query_embeddings
                WHERE provider = ?1
                    AND model = ?2
                    AND dimensions = ?3
                ORDER BY last_used_at DESC, rowid DESC
                LIMIT -1 OFFSET ?4
            );
            "#,
            params![
                CORPUS_PROVIDER_ZHIPU,
                config.model.trim(),
                config.dimensions,
                QUERY_EMBEDDING_CACHE_LIMIT
            ],
        )
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_QUERY_EMBEDDING_CACHE_PRUNE_FAILED",
                "裁剪教师案例检索向量缓存失败。",
                error.to_string(),
            )
        })?;
    Ok(())
}

fn row_to_teacher_case(row: &Row<'_>) -> rusqlite::Result<TeacherCase> {
    let embedding_status: String = row.get(5)?;
    let scoring_preference: Option<String> = row.get(4)?;
    let embedding_error: Option<String> = row.get(6)?;
    let created_at: i64 = row.get(7)?;
    let updated_at: i64 = row.get(8)?;
    Ok(TeacherCase {
        id: row.get(0)?,
        original_text: row.get(1)?,
        revised_text: row.get(2)?,
        teacher_comment: row.get(3)?,
        scoring_preference: scoring_preference
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        embedding_status: EmbeddingStatus::from_str(&embedding_status),
        embedding_error: embedding_error
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        created_at: created_at.to_string(),
        updated_at: updated_at.to_string(),
    })
}

fn encode_embedding_blob(embedding: &[f64]) -> Result<Vec<u8>, AppError> {
    let mut blob = Vec::with_capacity(embedding.len() * std::mem::size_of::<f32>());
    for value in embedding {
        if !value.is_finite() {
            return Err(AppError::new(
                "CORPUS_EMBEDDING_INVALID",
                "教师案例向量包含非法数值。",
            ));
        }
        blob.extend_from_slice(&(*value as f32).to_le_bytes());
    }

    Ok(blob)
}

fn decode_embedding_blob(blob: &[u8]) -> Result<Vec<f64>, AppError> {
    if blob.len() % std::mem::size_of::<f32>() != 0 {
        return Err(AppError::new(
            "CORPUS_EMBEDDING_PARSE_FAILED",
            "教师案例向量 BLOB 长度非法。",
        ));
    }

    blob.chunks_exact(std::mem::size_of::<f32>())
        .map(|chunk| {
            let bytes: [u8; 4] = chunk.try_into().map_err(|_| {
                AppError::new(
                    "CORPUS_EMBEDDING_PARSE_FAILED",
                    "教师案例向量 BLOB 无法解析。",
                )
            })?;
            let value = f32::from_le_bytes(bytes);
            if value.is_finite() {
                Ok(value as f64)
            } else {
                Err(AppError::new(
                    "CORPUS_EMBEDDING_PARSE_FAILED",
                    "教师案例向量 BLOB 包含非法数值。",
                ))
            }
        })
        .collect()
}

fn build_teacher_case_embedding_text(teacher_case: &TeacherCase) -> String {
    let scoring_preference = teacher_case
        .scoring_preference
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("\nScoring preference: {}", value.trim()))
        .unwrap_or_default();

    format!(
        "Original answer: {}\nRevised answer: {}\nTeacher comment: {}{}",
        teacher_case.original_text.trim(),
        teacher_case.revised_text.trim(),
        teacher_case.teacher_comment.trim(),
        scoring_preference,
    )
}

#[derive(Debug, Deserialize)]
struct ZhipuEmbeddingResponse {
    data: Vec<ZhipuEmbeddingData>,
}

#[derive(Debug, Deserialize)]
struct ZhipuEmbeddingData {
    embedding: Vec<f64>,
}

async fn request_zhipu_embedding(
    config: &StoredZhipuConfig,
    input: &str,
) -> Result<Vec<f64>, AppError> {
    let validation = validate_zhipu_embedding_config(config)?;
    let endpoint = zhipu_embeddings_endpoint(&validation.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| {
            AppError::with_detail(
                "ZHIPU_CLIENT_FAILED",
                "智谱 Embedding 客户端初始化失败。",
                error.to_string(),
            )
        })?;

    let mut retry_count = 0;
    loop {
        match request_zhipu_embedding_once(&client, &endpoint, &validation, input).await {
            Ok(embedding) => return Ok(embedding),
            Err(error)
                if retry_count < ZHIPU_EMBEDDING_MAX_RETRIES
                    && should_retry_zhipu_embedding_error(&error) =>
            {
                let backoff_multiplier = 1_u64 << retry_count;
                sleep_zhipu_embedding_retry(Duration::from_millis(
                    ZHIPU_EMBEDDING_INITIAL_BACKOFF_MS.saturating_mul(backoff_multiplier),
                ))
                .await?;
                retry_count += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

async fn sleep_zhipu_embedding_retry(backoff: Duration) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || std::thread::sleep(backoff))
        .await
        .map_err(|error| {
            AppError::with_detail(
                "ZHIPU_EMBEDDING_RETRY_SLEEP_FAILED",
                "智谱 Embedding 重试等待失败。",
                error.to_string(),
            )
        })
}

async fn request_zhipu_embedding_once(
    client: &reqwest::Client,
    endpoint: &str,
    validation: &ValidZhipuEmbeddingConfig<'_>,
    input: &str,
) -> Result<Vec<f64>, AppError> {
    let response = client
        .post(endpoint)
        .bearer_auth(validation.api_key)
        .json(&json!({
            "model": validation.model,
            "input": input,
            "dimensions": validation.dimensions,
        }))
        .send()
        .await
        .map_err(|error| {
            let code = if error.is_timeout() || error.is_connect() {
                "ZHIPU_EMBEDDING_RETRYABLE_REQUEST_FAILED"
            } else {
                "ZHIPU_EMBEDDING_REQUEST_FAILED"
            };
            AppError::with_detail(
                code,
                "智谱 Embedding 请求失败，请检查网络或 Base URL。",
                error.to_string(),
            )
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        let code = if error.is_timeout() || error.is_connect() {
            "ZHIPU_EMBEDDING_RETRYABLE_RESPONSE_READ_FAILED"
        } else {
            "ZHIPU_EMBEDDING_RESPONSE_READ_FAILED"
        };
        AppError::with_detail(code, "读取智谱 Embedding 响应失败。", error.to_string())
    })?;

    if !status.is_success() {
        let code = if zhipu_http_status_is_retryable(status) {
            "ZHIPU_EMBEDDING_RETRYABLE_HTTP_ERROR"
        } else {
            "ZHIPU_EMBEDDING_HTTP_ERROR"
        };
        return Err(AppError::with_detail(
            code,
            format!("智谱 Embedding 服务返回错误状态：{}。", status.as_u16()),
            summarize_for_debug(&body),
        ));
    }

    let parsed: ZhipuEmbeddingResponse = serde_json::from_str(&body).map_err(|error| {
        AppError::with_detail(
            "ZHIPU_EMBEDDING_RESPONSE_INVALID",
            "智谱 Embedding 响应格式无法解析。",
            format!("{}; body={}", error, summarize_for_debug(&body)),
        )
    })?;
    let embedding = parsed
        .data
        .into_iter()
        .next()
        .map(|item| item.embedding)
        .filter(|embedding| !embedding.is_empty())
        .ok_or_else(|| {
            AppError::with_detail(
                "ZHIPU_EMBEDDING_EMPTY",
                "智谱 Embedding 未返回向量。",
                summarize_for_debug(&body),
            )
        })?;

    if embedding.len() != validation.dimensions as usize {
        return Err(AppError::new(
            "ZHIPU_EMBEDDING_DIMENSIONS_MISMATCH",
            format!(
                "智谱 Embedding 返回维度为 {}，与配置的 {} 不一致。",
                embedding.len(),
                validation.dimensions
            ),
        ));
    }

    Ok(embedding)
}

fn zhipu_http_status_is_retryable(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn should_retry_zhipu_embedding_error(error: &AppError) -> bool {
    matches!(
        error.code,
        "ZHIPU_EMBEDDING_RETRYABLE_REQUEST_FAILED"
            | "ZHIPU_EMBEDDING_RETRYABLE_RESPONSE_READ_FAILED"
            | "ZHIPU_EMBEDDING_RETRYABLE_HTTP_ERROR"
    )
}

#[derive(Debug)]
struct ValidZhipuEmbeddingConfig<'a> {
    api_key: &'a str,
    base_url: String,
    model: String,
    dimensions: u16,
}

fn validate_zhipu_embedding_config(
    config: &StoredZhipuConfig,
) -> Result<ValidZhipuEmbeddingConfig<'_>, AppError> {
    let api_key = config
        .api_key
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("ZHIPU_KEY_MISSING", "请先在设置页配置智谱 API Key。"))?;
    let base_url = config.base_url.trim();
    if base_url.is_empty() {
        return Err(AppError::new(
            "ZHIPU_BASE_URL_EMPTY",
            "智谱 Base URL 不能为空。",
        ));
    }
    let model = config.model.trim();
    if model.is_empty() {
        return Err(AppError::new(
            "ZHIPU_MODEL_EMPTY",
            "智谱 Embedding 模型不能为空。",
        ));
    }
    if config.dimensions != ZHIPU_EMBEDDING_DIMENSIONS {
        return Err(AppError::new(
            "ZHIPU_DIMENSIONS_INVALID",
            format!("智谱 Embedding 维度必须是 {ZHIPU_EMBEDDING_DIMENSIONS}。"),
        ));
    }

    Ok(ValidZhipuEmbeddingConfig {
        api_key,
        base_url: base_url.to_string(),
        model: model.to_string(),
        dimensions: config.dimensions,
    })
}

fn zhipu_embeddings_endpoint(base_url: &str) -> Result<String, AppError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::new(
            "ZHIPU_BASE_URL_EMPTY",
            "智谱 Base URL 不能为空。",
        ));
    }

    if trimmed.ends_with("/embeddings") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/embeddings"))
    }
}

fn cosine_similarity(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.len() != right.len() || left.is_empty() {
        return None;
    }

    let mut dot_product = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot_product += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }

    let denominator = left_norm.sqrt() * right_norm.sqrt();
    if denominator == 0.0 || !denominator.is_finite() {
        return None;
    }

    Some(dot_product / denominator)
}

fn summarize_for_debug(value: &str) -> String {
    value
        .chars()
        .take(600)
        .collect::<String>()
        .replace(['\n', '\r'], " ")
}

fn teacher_case_embedding_error_summary(error: &AppError) -> String {
    let detail = error
        .detail
        .as_deref()
        .map(summarize_for_debug)
        .filter(|value| !value.trim().is_empty());
    let summary = match detail {
        Some(detail) => format!("{}: {}", error.message, detail),
        None => error.message.clone(),
    };
    summary.chars().take(600).collect()
}

fn normalize_teacher_case_input(input: TeacherCaseInput) -> Result<TeacherCaseInput, AppError> {
    let original_text = trim_and_limit(input.original_text);
    let revised_text = trim_and_limit(input.revised_text);
    let teacher_comment = trim_and_limit(input.teacher_comment);
    let scoring_preference = input
        .scoring_preference
        .map(trim_and_limit)
        .filter(|value| !value.is_empty());

    if original_text.is_empty() {
        return Err(AppError::new(
            "CORPUS_CASE_INVALID",
            "学生原始文本不能为空。",
        ));
    }

    if revised_text.is_empty() {
        return Err(AppError::new(
            "CORPUS_CASE_INVALID",
            "教师修改后文本不能为空。",
        ));
    }

    if teacher_comment.is_empty() {
        return Err(AppError::new("CORPUS_CASE_INVALID", "教师评语不能为空。"));
    }

    Ok(TeacherCaseInput {
        original_text,
        revised_text,
        teacher_comment,
        scoring_preference,
    })
}

fn trim_and_limit(value: String) -> String {
    value.trim().chars().take(4_000).collect()
}

fn generate_teacher_case_id() -> String {
    format!("teacher-case-{}", Uuid::new_v4())
}

fn timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::TEACHER_CASE_SIMILARITY_THRESHOLD;

    fn temp_db_path(name: &str) -> (tempfile::TempDir, PathBuf) {
        let temp_dir = tempfile::Builder::new()
            .prefix(name)
            .tempdir()
            .expect("create isolated corpus test directory");
        let db_path = temp_dir.path().join("teacher-cases.sqlite3");

        (temp_dir, db_path)
    }

    fn valid_input(original_text: &str) -> TeacherCaseInput {
        TeacherCaseInput {
            original_text: original_text.to_string(),
            revised_text:
                "I really enjoy studying English because it helps me communicate clearly."
                    .to_string(),
            teacher_comment: "表达方向清楚，建议增加具体例子和更自然的连接。".to_string(),
            scoring_preference: Some("更重视流利度和自然表达。".to_string()),
        }
    }

    fn test_zhipu_config(dimensions: u16) -> StoredZhipuConfig {
        StoredZhipuConfig {
            api_key: Some("zhipu-test".to_string()),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions,
            similarity_threshold: TEACHER_CASE_SIMILARITY_THRESHOLD,
        }
    }

    fn backup_files_for(db_path: &Path) -> Vec<PathBuf> {
        let parent = db_path.parent().expect("db parent");
        let file_name = db_path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("db file name");

        fs::read_dir(parent)
            .expect("read db parent")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|value| value.to_str())
                    .map(|name| name.starts_with(&format!("{file_name}.backup-")))
                    .unwrap_or(false)
            })
            .collect()
    }

    fn create_legacy_corpus_database(db_path: &Path, embedding_json: &str) -> Result<(), AppError> {
        let connection = Connection::open(db_path).expect("open legacy db");
        connection
            .execute_batch(
                r#"
                CREATE TABLE teacher_cases (
                    id TEXT PRIMARY KEY NOT NULL,
                    original_text TEXT NOT NULL,
                    revised_text TEXT NOT NULL,
                    teacher_comment TEXT NOT NULL,
                    scoring_preference TEXT,
                    embedding_status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE teacher_case_embeddings (
                    case_id TEXT PRIMARY KEY NOT NULL,
                    embedding_json TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    dimensions INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(case_id) REFERENCES teacher_cases(id) ON DELETE CASCADE
                );
                "#,
            )
            .expect("create legacy schema");
        connection
            .execute(
                r#"
                INSERT INTO teacher_cases (
                    id,
                    original_text,
                    revised_text,
                    teacher_comment,
                    scoring_preference,
                    embedding_status,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8);
                "#,
                params![
                    "legacy-case",
                    "I like old sqlite storage.",
                    "I enjoy the legacy SQLite storage after migration.",
                    "Keep the original meaning but make it more precise.",
                    "prioritize fluency",
                    "ready",
                    "1700000000000000000",
                    "1700000001000000000"
                ],
            )
            .expect("insert legacy case");
        connection
            .execute(
                r#"
                INSERT INTO teacher_case_embeddings (
                    case_id,
                    embedding_json,
                    provider,
                    model,
                    dimensions,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6);
                "#,
                params![
                    "legacy-case",
                    embedding_json,
                    CORPUS_PROVIDER_ZHIPU,
                    "embedding-3",
                    3,
                    "1700000001000000000"
                ],
            )
            .expect("insert legacy embedding");

        Ok(())
    }

    #[test]
    fn creates_lists_updates_and_deletes_single_teacher_case() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-crud");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");

        assert_eq!(created.embedding_status, EmbeddingStatus::Pending);
        assert_eq!(created.embedding_error, None);
        assert_eq!(created.original_text, "I like English.");
        assert!(created.id.starts_with("teacher-case-"));
        assert!(created.created_at.parse::<i64>().expect("created millis") > 0);
        assert!(created.updated_at.parse::<i64>().expect("updated millis") > 0);

        let listed = list_teacher_cases_at_path(&db_path).expect("list cases");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let updated = update_teacher_case_at_path(
            &db_path,
            &created.id,
            valid_input("I enjoy learning English with my teacher."),
        )
        .expect("update case");
        assert_eq!(
            updated.original_text,
            "I enjoy learning English with my teacher."
        );
        assert_eq!(updated.embedding_status, EmbeddingStatus::Pending);
        assert_eq!(updated.embedding_error, None);

        delete_teacher_case_at_path(&db_path, &created.id).expect("delete one case");
        let listed_after_delete = list_teacher_cases_at_path(&db_path).expect("list after delete");
        assert!(listed_after_delete.is_empty());
    }

    #[test]
    fn stores_special_characters_without_silent_data_loss() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-special-characters");
        let created = create_teacher_case_at_path(
            &db_path,
            TeacherCaseInput {
                original_text: "I'm learning\n雅思口语 😊 & \"quotes\".".to_string(),
                revised_text: "I'm learning IELTS speaking with clearer examples 😊.".to_string(),
                teacher_comment: "保留语气；注意 don't 的撇号和换行。\nSecond line.".to_string(),
                scoring_preference: Some("LR > GRA; don't over-polish 😊".to_string()),
            },
        )
        .expect("create case with special characters");

        let fetched = get_teacher_case_at_path(&db_path, &created.id).expect("fetch case");
        assert_eq!(
            fetched.original_text,
            "I'm learning\n雅思口语 😊 & \"quotes\"."
        );
        assert_eq!(
            fetched.teacher_comment,
            "保留语气；注意 don't 的撇号和换行。\nSecond line."
        );
        assert_eq!(
            fetched.scoring_preference.as_deref(),
            Some("LR > GRA; don't over-polish 😊")
        );
    }

    #[test]
    fn rejects_empty_required_teacher_case_fields() {
        let error = normalize_teacher_case_input(valid_input("   "))
            .expect_err("empty original should fail");
        assert_eq!(error.code, "CORPUS_CASE_INVALID");
    }

    #[test]
    fn returns_not_found_for_single_record_delete() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-not-found");
        let error = delete_teacher_case_at_path(&db_path, "missing-case")
            .expect_err("missing case should fail");
        assert_eq!(error.code, "CORPUS_CASE_NOT_FOUND");
    }

    #[test]
    fn validates_zhipu_embedding_config_before_network_request() {
        let missing_key_error = validate_zhipu_embedding_config(&StoredZhipuConfig {
            api_key: None,
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
            similarity_threshold: TEACHER_CASE_SIMILARITY_THRESHOLD,
        })
        .expect_err("missing key should fail before network");
        assert_eq!(missing_key_error.code, "ZHIPU_KEY_MISSING");

        let invalid_dimensions_error = validate_zhipu_embedding_config(&StoredZhipuConfig {
            api_key: Some("zhipu-test".to_string()),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions: 768,
            similarity_threshold: TEACHER_CASE_SIMILARITY_THRESHOLD,
        })
        .expect_err("invalid dimensions should fail");
        assert_eq!(invalid_dimensions_error.code, "ZHIPU_DIMENSIONS_INVALID");
    }

    #[test]
    fn initializes_and_migrates_embedding_error_column_for_current_schema() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-embedding-error-schema");
        let connection = open_corpus_connection(&db_path).expect("open db");
        connection
            .execute_batch(
                r#"
                CREATE TABLE teacher_cases (
                    id TEXT PRIMARY KEY NOT NULL,
                    original_text TEXT NOT NULL,
                    revised_text TEXT NOT NULL,
                    teacher_comment TEXT NOT NULL,
                    scoring_preference TEXT,
                    embedding_status TEXT NOT NULL DEFAULT 'pending',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE teacher_case_embeddings (
                    case_id TEXT PRIMARY KEY NOT NULL,
                    embedding_blob BLOB NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    dimensions INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY(case_id) REFERENCES teacher_cases(id) ON DELETE CASCADE
                );
                "#,
            )
            .expect("create phase 1 schema");
        drop(connection);

        initialize_teacher_cases_schema(&db_path).expect("migrate current schema");

        let connection = open_corpus_connection(&db_path).expect("open migrated db");
        let teacher_case_columns =
            table_columns(&connection, "teacher_cases").expect("teacher case columns");
        assert!(column_exists(&teacher_case_columns, "embedding_error"));
    }

    #[test]
    fn builds_zhipu_embeddings_endpoint() {
        assert_eq!(
            zhipu_embeddings_endpoint("https://open.bigmodel.cn/api/paas/v4").expect("endpoint"),
            "https://open.bigmodel.cn/api/paas/v4/embeddings"
        );
        assert_eq!(
            zhipu_embeddings_endpoint("https://open.bigmodel.cn/api/paas/v4/embeddings")
                .expect("endpoint"),
            "https://open.bigmodel.cn/api/paas/v4/embeddings"
        );
    }

    #[test]
    fn stores_and_clears_teacher_case_embedding_locally() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-embedding-storage");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");
        let config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);
        let embedding = vec![1.0; ZHIPU_EMBEDDING_DIMENSIONS as usize];

        upsert_teacher_case_embedding_at_path(&db_path, &created.id, &embedding, &config)
            .expect("store embedding");
        set_teacher_case_embedding_status_at_path(&db_path, &created.id, EmbeddingStatus::Ready)
            .expect("ready status");
        let embeddings = list_ready_teacher_case_embeddings_at_path(&db_path, &config)
            .expect("list ready embeddings");
        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].case_id, created.id);
        assert_eq!(embeddings[0].embedding, embedding);

        delete_teacher_case_embedding_at_path(&db_path, &created.id).expect("clear embedding");
        let embeddings_after_clear = list_ready_teacher_case_embeddings_at_path(&db_path, &config)
            .expect("list after clear");
        assert!(embeddings_after_clear.is_empty());
    }

    #[test]
    fn encodes_and_decodes_f32_embedding_blob() {
        let embedding = vec![1.0, -0.5, 0.25, std::f64::consts::PI];
        let blob = encode_embedding_blob(&embedding).expect("encode embedding");
        assert_eq!(blob.len(), embedding.len() * std::mem::size_of::<f32>());

        let decoded = decode_embedding_blob(&blob).expect("decode embedding");
        assert_eq!(decoded.len(), embedding.len());
        for (actual, expected) in decoded.iter().zip(embedding.iter()) {
            assert!((actual - expected).abs() < 0.000_001);
        }

        let invalid = decode_embedding_blob(&[1, 2, 3]).expect_err("invalid length should fail");
        assert_eq!(invalid.code, "CORPUS_EMBEDDING_PARSE_FAILED");
    }

    #[test]
    fn update_resets_status_and_clears_existing_embedding_transactionally() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-update-clears-embedding");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");
        let config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);
        let embedding = vec![1.0; ZHIPU_EMBEDDING_DIMENSIONS as usize];
        upsert_teacher_case_embedding_and_mark_ready_at_path(
            &db_path,
            &created.id,
            &embedding,
            &config,
        )
        .expect("store embedding and mark ready");
        mark_teacher_case_embedding_failed_at_path(&db_path, &created.id, "temporary failure")
            .expect("mark failed before update");

        let updated = update_teacher_case_at_path(
            &db_path,
            &created.id,
            valid_input("I now describe my English study with more detail."),
        )
        .expect("update case");
        assert_eq!(updated.embedding_status, EmbeddingStatus::Pending);
        assert_eq!(updated.embedding_error, None);

        let embeddings = list_ready_teacher_case_embeddings_at_path(&db_path, &config)
            .expect("list embeddings after update");
        assert!(embeddings.is_empty());
    }

    #[test]
    fn upsert_embedding_and_ready_status_commit_together() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-ready-transaction");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");
        let config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);
        let embedding = vec![0.25; ZHIPU_EMBEDDING_DIMENSIONS as usize];

        let ready_case = upsert_teacher_case_embedding_and_mark_ready_at_path(
            &db_path,
            &created.id,
            &embedding,
            &config,
        )
        .expect("store embedding and mark ready");

        assert_eq!(ready_case.embedding_status, EmbeddingStatus::Ready);
        assert_eq!(ready_case.embedding_error, None);
        let embeddings = list_ready_teacher_case_embeddings_at_path(&db_path, &config)
            .expect("list ready embeddings");
        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].case_id, created.id);
        assert_eq!(embeddings[0].embedding, embedding);
    }

    #[test]
    fn filters_ready_embeddings_by_current_provider_model_and_dimensions() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-embedding-dimension-filter");
        let non_current_dimension_case =
            create_teacher_case_at_path(&db_path, valid_input("I enjoy reading."))
                .expect("create non-current dimension case");
        let current_dimension_case =
            create_teacher_case_at_path(&db_path, valid_input("I enjoy speaking English."))
                .expect("create current dimension case");
        let non_current_dimension_config = test_zhipu_config(2048);
        let current_dimension_config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);

        upsert_teacher_case_embedding_at_path(
            &db_path,
            &non_current_dimension_case.id,
            &vec![0.5; non_current_dimension_config.dimensions as usize],
            &non_current_dimension_config,
        )
        .expect("store non-current dimension embedding");
        upsert_teacher_case_embedding_at_path(
            &db_path,
            &current_dimension_case.id,
            &vec![1.0; current_dimension_config.dimensions as usize],
            &current_dimension_config,
        )
        .expect("store current dimension embedding");
        set_teacher_case_embedding_status_at_path(
            &db_path,
            &non_current_dimension_case.id,
            EmbeddingStatus::Ready,
        )
        .expect("non-current ready status");
        set_teacher_case_embedding_status_at_path(
            &db_path,
            &current_dimension_case.id,
            EmbeddingStatus::Ready,
        )
        .expect("current ready status");

        let embeddings =
            list_ready_teacher_case_embeddings_at_path(&db_path, &current_dimension_config)
                .expect("list current embeddings");

        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].case_id, current_dimension_case.id);
    }

    #[test]
    fn stores_embedding_failure_reason_on_case() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-embedding-failed");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");

        let failed = mark_teacher_case_embedding_failed_at_path(
            &db_path,
            &created.id,
            "智谱 Embedding 服务返回错误状态：429。",
        )
        .expect("mark failed");

        assert_eq!(failed.embedding_status, EmbeddingStatus::Failed);
        assert_eq!(
            failed.embedding_error.as_deref(),
            Some("智谱 Embedding 服务返回错误状态：429。")
        );
    }

    #[test]
    fn migrates_legacy_json_vector_database_with_backup() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-legacy-migration");
        create_legacy_corpus_database(&db_path, "[1.0,0.5,-0.25]").expect("create legacy db");

        initialize_teacher_cases_schema(&db_path).expect("migrate legacy db");

        let backups = backup_files_for(&db_path);
        assert_eq!(backups.len(), 1);

        let connection = open_corpus_connection(&db_path).expect("open migrated db");
        assert_eq!(
            detect_corpus_schema_state(&connection).expect("detect schema"),
            CorpusSchemaState::Current
        );
        let embedding_columns =
            table_columns(&connection, "teacher_case_embeddings").expect("embedding columns");
        assert!(column_exists(&embedding_columns, "embedding_blob"));
        assert!(!column_exists(&embedding_columns, "embedding_json"));
        drop(connection);

        let cases = list_teacher_cases_at_path(&db_path).expect("list migrated cases");
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].id, "legacy-case");
        assert_eq!(cases[0].embedding_error, None);
        assert_eq!(cases[0].created_at, "1700000000000");
        assert_eq!(cases[0].updated_at, "1700000001000");

        let embeddings =
            list_ready_teacher_case_embeddings_at_path(&db_path, &test_zhipu_config(3))
                .expect("list migrated embeddings");
        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].embedding, vec![1.0, 0.5, -0.25]);
    }

    #[test]
    fn migration_failure_keeps_original_database_and_backup() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-legacy-migration-failure");
        create_legacy_corpus_database(&db_path, "not-json").expect("create invalid legacy db");
        let original_bytes = fs::read(&db_path).expect("read original db");

        let error = initialize_teacher_cases_schema(&db_path)
            .expect_err("invalid legacy embedding should fail migration");
        assert_eq!(error.code, "CORPUS_MIGRATION_READ_FAILED");

        let after_bytes = fs::read(&db_path).expect("read db after failed migration");
        assert_eq!(after_bytes, original_bytes);
        assert_eq!(backup_files_for(&db_path).len(), 1);
    }

    #[test]
    fn filters_search_matches_below_similarity_threshold() {
        let ranked = filter_and_rank_teacher_case_matches(
            vec![
                (
                    "below".to_string(),
                    TEACHER_CASE_SIMILARITY_THRESHOLD - 0.0001,
                ),
                ("best".to_string(), 0.91),
                ("second".to_string(), 0.72),
                ("third".to_string(), 0.61),
            ],
            2,
            TEACHER_CASE_SIMILARITY_THRESHOLD,
        );

        assert_eq!(
            ranked,
            vec![("best".to_string(), 0.91), ("second".to_string(), 0.72)]
        );
    }

    #[test]
    fn validates_similarity_threshold_override() {
        assert_eq!(
            validated_similarity_threshold(0.0).expect("lower bound"),
            0.0
        );
        assert_eq!(
            validated_similarity_threshold(1.0).expect("upper bound"),
            1.0
        );

        let error = validated_similarity_threshold(1.01).expect_err("out of range");
        assert_eq!(error.code, "CORPUS_SEARCH_THRESHOLD_INVALID");
    }

    #[test]
    fn builds_stable_query_embedding_cache_hash_from_normalized_query() {
        let config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);
        let compact_query = normalize_query_text_for_cache("Question: travel Answer: I like it.");
        let spaced_query =
            normalize_query_text_for_cache(" Question: travel\n\nAnswer:   I like it. ");
        let compact_hash = build_query_embedding_cache_hash(&config, &compact_query);
        let spaced_hash = build_query_embedding_cache_hash(&config, &spaced_query);
        let different_model_hash = build_query_embedding_cache_hash(
            &StoredZhipuConfig {
                model: "embedding-3-alt".to_string(),
                ..config.clone()
            },
            &compact_query,
        );

        assert_eq!(compact_hash, spaced_hash);
        assert_ne!(compact_hash, different_model_hash);
        assert_eq!(compact_hash.len(), 64);
    }

    #[test]
    fn stores_query_embedding_cache_without_original_query_and_prunes_lru() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-query-cache");
        let config = test_zhipu_config(ZHIPU_EMBEDDING_DIMENSIONS);
        let embedding = vec![0.25; ZHIPU_EMBEDDING_DIMENSIONS as usize];

        for index in 0..=QUERY_EMBEDDING_CACHE_LIMIT {
            upsert_query_embedding_cache_at_path(
                &db_path,
                &config,
                &format!("query-hash-{index:03}"),
                &embedding,
            )
            .expect("store query cache");
        }

        let connection = open_corpus_connection(&db_path).expect("open cache db");
        let cache_columns =
            table_columns(&connection, "teacher_case_query_embeddings").expect("cache columns");
        assert!(column_exists(&cache_columns, "query_hash"));
        assert!(!column_exists(&cache_columns, "query_text"));
        let row_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM teacher_case_query_embeddings;",
                [],
                |row| row.get(0),
            )
            .expect("count cache rows");
        assert_eq!(row_count, QUERY_EMBEDDING_CACHE_LIMIT);
        drop(connection);

        let cached = read_query_embedding_cache_at_path(&db_path, &config, "query-hash-200")
            .expect("read cached embedding")
            .expect("cache hit");
        assert_eq!(cached, embedding);
        assert!(
            read_query_embedding_cache_at_path(&db_path, &config, "query-hash-000")
                .expect("read pruned embedding")
                .is_none()
        );
    }

    #[test]
    fn builds_search_diagnostics_with_included_and_near_miss_matches() {
        let (_temp_dir, db_path) = temp_db_path("teacher-case-search-diagnostics");
        let included_case =
            create_teacher_case_at_path(&db_path, valid_input("I enjoy city travel."))
                .expect("create included case");
        let near_miss_case =
            create_teacher_case_at_path(&db_path, valid_input("I prefer quiet reading."))
                .expect("create near miss case");
        let config = test_zhipu_config(3);
        upsert_teacher_case_embedding_at_path(
            &db_path,
            &included_case.id,
            &[1.0, 0.0, 0.0],
            &config,
        )
        .expect("store included embedding");
        upsert_teacher_case_embedding_at_path(
            &db_path,
            &near_miss_case.id,
            &[0.5, 0.5, 0.0],
            &config,
        )
        .expect("store near miss embedding");
        set_teacher_case_embedding_status_at_path(
            &db_path,
            &included_case.id,
            EmbeddingStatus::Ready,
        )
        .expect("included ready");
        set_teacher_case_embedding_status_at_path(
            &db_path,
            &near_miss_case.id,
            EmbeddingStatus::Ready,
        )
        .expect("near miss ready");

        let diagnostics = build_teacher_case_search_diagnostics(
            &db_path,
            &config,
            &[1.0, 0.0, 0.0],
            3,
            0.8,
            QueryEmbeddingSource::Cache,
            Duration::from_millis(12),
        )
        .expect("diagnostics");

        assert_eq!(diagnostics.threshold, 0.8);
        assert_eq!(diagnostics.ready_candidate_count, 2);
        assert_eq!(diagnostics.matched_count, 1);
        assert_eq!(diagnostics.below_threshold_count, 1);
        assert_eq!(diagnostics.embedding_source, QueryEmbeddingSource::Cache);
        assert_eq!(diagnostics.duration_ms, 12);
        assert_eq!(diagnostics.included[0].r#case.id, included_case.id);
        assert_eq!(diagnostics.near_misses[0].r#case.id, near_miss_case.id);
    }

    #[test]
    fn calculates_cosine_similarity_for_top_k_search() {
        let same_direction =
            cosine_similarity(&[1.0, 0.0, 0.0], &[0.5, 0.0, 0.0]).expect("same direction");
        let opposite_direction =
            cosine_similarity(&[1.0, 0.0, 0.0], &[-1.0, 0.0, 0.0]).expect("opposite direction");

        assert!((same_direction - 1.0).abs() < 0.000_001);
        assert!((opposite_direction + 1.0).abs() < 0.000_001);
        assert!(cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]).is_none());
    }

    #[test]
    fn validates_teacher_case_search_request() {
        assert!(validate_teacher_case_search_request("student answer", 3).is_ok());

        let empty_error =
            validate_teacher_case_search_request(" ", 2).expect_err("empty query should fail");
        assert_eq!(empty_error.code, "CORPUS_SEARCH_QUERY_EMPTY");

        let top_k_error = validate_teacher_case_search_request("student answer", 4)
            .expect_err("top_k should be capped");
        assert_eq!(top_k_error.code, "CORPUS_SEARCH_TOP_K_INVALID");
    }

    #[test]
    fn retries_only_transient_zhipu_embedding_errors() {
        assert!(zhipu_http_status_is_retryable(
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(zhipu_http_status_is_retryable(
            reqwest::StatusCode::BAD_GATEWAY
        ));
        assert!(!zhipu_http_status_is_retryable(
            reqwest::StatusCode::UNAUTHORIZED
        ));

        assert!(should_retry_zhipu_embedding_error(&AppError::new(
            "ZHIPU_EMBEDDING_RETRYABLE_HTTP_ERROR",
            "retry"
        )));
        assert!(!should_retry_zhipu_embedding_error(&AppError::new(
            "ZHIPU_EMBEDDING_RESPONSE_INVALID",
            "do not retry"
        )));
    }
}
