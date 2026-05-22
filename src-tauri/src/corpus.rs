use crate::{read_config, AppError, StoredZhipuConfig};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

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

#[tauri::command]
pub(crate) fn create_teacher_case(
    app: AppHandle,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    create_teacher_case_at_path(&db_path, input)
}

#[tauri::command]
pub(crate) fn list_teacher_cases(app: AppHandle) -> Result<Vec<TeacherCase>, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    list_teacher_cases_at_path(&db_path)
}

#[tauri::command]
pub(crate) fn get_teacher_case(app: AppHandle, id: String) -> Result<TeacherCase, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    get_teacher_case_at_path(&db_path, &id)
}

#[tauri::command]
pub(crate) fn update_teacher_case(
    app: AppHandle,
    id: String,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    update_teacher_case_at_path(&db_path, &id, input)
}

#[tauri::command]
pub(crate) fn delete_teacher_case(app: AppHandle, id: String) -> Result<(), AppError> {
    let db_path = teacher_cases_db_path(&app)?;
    delete_teacher_case_at_path(&db_path, &id)
}

#[tauri::command]
pub(crate) async fn rebuild_teacher_case_embedding(
    app: AppHandle,
    id: String,
) -> Result<TeacherCase, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    rebuild_teacher_case_embedding_at_path(&db_path, &config.zhipu, &id).await
}

#[tauri::command]
pub(crate) async fn search_teacher_cases(
    app: AppHandle,
    query_text: String,
    top_k: u8,
) -> Result<Vec<TeacherCaseMatch>, AppError> {
    let config = read_config(&app)?;
    let db_path = teacher_cases_db_path(&app)?;
    search_teacher_cases_at_path(&db_path, &config.zhipu, &query_text, top_k).await
}

async fn rebuild_teacher_case_embedding_at_path(
    db_path: &Path,
    config: &StoredZhipuConfig,
    id: &str,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let teacher_case = get_teacher_case_at_path(db_path, id)?;
    let embedding_text = build_teacher_case_embedding_text(&teacher_case);
    let embedding = request_zhipu_embedding(config, &embedding_text).await?;
    upsert_teacher_case_embedding_at_path(db_path, &teacher_case.id, &embedding, config)?;
    set_teacher_case_embedding_status_at_path(db_path, &teacher_case.id, EmbeddingStatus::Ready)?;
    get_teacher_case_at_path(db_path, &teacher_case.id)
}

async fn search_teacher_cases_at_path(
    db_path: &Path,
    config: &StoredZhipuConfig,
    query_text: &str,
    top_k: u8,
) -> Result<Vec<TeacherCaseMatch>, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    validate_teacher_case_search_request(&query_text, top_k)?;
    let query_embedding = request_zhipu_embedding(config, query_text.trim()).await?;
    let stored_embeddings = list_ready_teacher_case_embeddings_at_path(db_path)?;
    let mut matches = stored_embeddings
        .into_iter()
        .filter(|stored_embedding| stored_embedding.embedding.len() == query_embedding.len())
        .filter_map(|stored_embedding| {
            let score = cosine_similarity(&query_embedding, &stored_embedding.embedding)?;
            Some((stored_embedding.case_id, score))
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| right.1.total_cmp(&left.1));
    matches
        .into_iter()
        .take(top_k as usize)
        .map(|(case_id, score)| {
            get_teacher_case_at_path(db_path, &case_id).map(|teacher_case| TeacherCaseMatch {
                r#case: teacher_case,
                score,
            })
        })
        .collect()
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

    run_sqlite_statement(
        db_path,
        r#"
        CREATE TABLE IF NOT EXISTS teacher_cases (
            id TEXT PRIMARY KEY NOT NULL,
            original_text TEXT NOT NULL,
            revised_text TEXT NOT NULL,
            teacher_comment TEXT NOT NULL,
            scoring_preference TEXT,
            embedding_status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_teacher_cases_updated_at
            ON teacher_cases(updated_at DESC);
        CREATE TABLE IF NOT EXISTS teacher_case_embeddings (
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
    .map(|_| ())
}

fn create_teacher_case_at_path(
    db_path: &Path,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let normalized_input = normalize_teacher_case_input(input)?;
    let now = timestamp_string();
    let teacher_case = TeacherCase {
        id: generate_teacher_case_id(),
        original_text: normalized_input.original_text,
        revised_text: normalized_input.revised_text,
        teacher_comment: normalized_input.teacher_comment,
        scoring_preference: normalized_input.scoring_preference,
        embedding_status: EmbeddingStatus::Pending,
        created_at: now.clone(),
        updated_at: now,
    };

    let scoring_preference = teacher_case.scoring_preference.as_deref().unwrap_or("");
    let sql = format!(
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
        ) VALUES (
            {id},
            {original_text},
            {revised_text},
            {teacher_comment},
            {scoring_preference},
            {embedding_status},
            {created_at},
            {updated_at}
        );
        "#,
        id = sqlite_text_literal(&teacher_case.id),
        original_text = sqlite_text_literal(&teacher_case.original_text),
        revised_text = sqlite_text_literal(&teacher_case.revised_text),
        teacher_comment = sqlite_text_literal(&teacher_case.teacher_comment),
        scoring_preference = sqlite_text_literal(scoring_preference),
        embedding_status = sqlite_text_literal(teacher_case.embedding_status.as_str()),
        created_at = sqlite_text_literal(&teacher_case.created_at),
        updated_at = sqlite_text_literal(&teacher_case.updated_at),
    );
    run_sqlite_statement(db_path, &sql)?;

    get_teacher_case_at_path(db_path, &teacher_case.id)
}

fn list_teacher_cases_at_path(db_path: &Path) -> Result<Vec<TeacherCase>, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let output = run_sqlite_statement(
        db_path,
        r#"
        SELECT json_object(
            'id', id,
            'originalText', original_text,
            'revisedText', revised_text,
            'teacherComment', teacher_comment,
            'scoringPreference', NULLIF(scoring_preference, ''),
            'embeddingStatus', embedding_status,
            'createdAt', created_at,
            'updatedAt', updated_at
        )
        FROM teacher_cases
        ORDER BY updated_at DESC, created_at DESC;
        "#,
    )?;

    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_teacher_case_json_line)
        .collect()
}

fn get_teacher_case_at_path(db_path: &Path, id: &str) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    let sql = format!(
        r#"
        SELECT json_object(
            'id', id,
            'originalText', original_text,
            'revisedText', revised_text,
            'teacherComment', teacher_comment,
            'scoringPreference', NULLIF(scoring_preference, ''),
            'embeddingStatus', embedding_status,
            'createdAt', created_at,
            'updatedAt', updated_at
        )
        FROM teacher_cases
        WHERE id = {id};
        "#,
        id = sqlite_text_literal(id.trim()),
    );
    let output = run_sqlite_statement(db_path, &sql)?;

    output
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(parse_teacher_case_json_line)
        .transpose()?
        .ok_or_else(|| AppError::new("CORPUS_CASE_NOT_FOUND", "未找到指定教师案例。"))
}

fn update_teacher_case_at_path(
    db_path: &Path,
    id: &str,
    input: TeacherCaseInput,
) -> Result<TeacherCase, AppError> {
    initialize_teacher_cases_schema(db_path)?;
    get_teacher_case_at_path(db_path, id)?;
    let normalized_input = normalize_teacher_case_input(input)?;
    let updated_at = timestamp_string();

    let scoring_preference = normalized_input.scoring_preference.as_deref().unwrap_or("");
    let sql = format!(
        r#"
        UPDATE teacher_cases
        SET
            original_text = {original_text},
            revised_text = {revised_text},
            teacher_comment = {teacher_comment},
            scoring_preference = {scoring_preference},
            embedding_status = 'pending',
            updated_at = {updated_at}
        WHERE id = {id};
        "#,
        original_text = sqlite_text_literal(&normalized_input.original_text),
        revised_text = sqlite_text_literal(&normalized_input.revised_text),
        teacher_comment = sqlite_text_literal(&normalized_input.teacher_comment),
        scoring_preference = sqlite_text_literal(scoring_preference),
        updated_at = sqlite_text_literal(&updated_at),
        id = sqlite_text_literal(id.trim()),
    );
    run_sqlite_statement(db_path, &sql)?;
    delete_teacher_case_embedding_at_path(db_path, id)?;

    get_teacher_case_at_path(db_path, id)
}

fn delete_teacher_case_at_path(db_path: &Path, id: &str) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    get_teacher_case_at_path(db_path, id)?;
    delete_teacher_case_embedding_at_path(db_path, id)?;
    let sql = format!(
        "DELETE FROM teacher_cases WHERE id = {};",
        sqlite_text_literal(id.trim())
    );
    run_sqlite_statement(db_path, &sql)?;
    Ok(())
}

fn set_teacher_case_embedding_status_at_path(
    db_path: &Path,
    id: &str,
    embedding_status: EmbeddingStatus,
) -> Result<(), AppError> {
    let sql = format!(
        "UPDATE teacher_cases SET embedding_status = {embedding_status}, updated_at = {updated_at} WHERE id = {id};",
        embedding_status = sqlite_text_literal(embedding_status.as_str()),
        updated_at = sqlite_text_literal(&timestamp_string()),
        id = sqlite_text_literal(id.trim()),
    );
    run_sqlite_statement(db_path, &sql).map(|_| ())
}

fn upsert_teacher_case_embedding_at_path(
    db_path: &Path,
    case_id: &str,
    embedding: &[f64],
    config: &StoredZhipuConfig,
) -> Result<(), AppError> {
    let embedding_json = serde_json::to_string(embedding).map_err(|error| {
        AppError::with_detail(
            "CORPUS_EMBEDDING_SERIALIZE_FAILED",
            "教师案例向量序列化失败。",
            error.to_string(),
        )
    })?;
    let sql = format!(
        r#"
        INSERT INTO teacher_case_embeddings (
            case_id,
            embedding_json,
            provider,
            model,
            dimensions,
            updated_at
        ) VALUES (
            {case_id},
            {embedding_json},
            'zhipu',
            {model},
            {dimensions},
            {updated_at}
        )
        ON CONFLICT(case_id) DO UPDATE SET
            embedding_json = excluded.embedding_json,
            provider = excluded.provider,
            model = excluded.model,
            dimensions = excluded.dimensions,
            updated_at = excluded.updated_at;
        "#,
        case_id = sqlite_text_literal(case_id),
        embedding_json = sqlite_text_literal(&embedding_json),
        model = sqlite_text_literal(&config.model),
        dimensions = config.dimensions,
        updated_at = sqlite_text_literal(&timestamp_string()),
    );
    run_sqlite_statement(db_path, &sql).map(|_| ())
}

fn delete_teacher_case_embedding_at_path(db_path: &Path, case_id: &str) -> Result<(), AppError> {
    let sql = format!(
        "DELETE FROM teacher_case_embeddings WHERE case_id = {};",
        sqlite_text_literal(case_id.trim())
    );
    run_sqlite_statement(db_path, &sql).map(|_| ())
}

#[derive(Debug)]
struct StoredTeacherCaseEmbedding {
    case_id: String,
    embedding: Vec<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeacherCaseEmbeddingJsonRow {
    case_id: String,
    embedding_json: String,
}

fn list_ready_teacher_case_embeddings_at_path(
    db_path: &Path,
) -> Result<Vec<StoredTeacherCaseEmbedding>, AppError> {
    let output = run_sqlite_statement(
        db_path,
        r#"
        SELECT json_object(
            'caseId', teacher_case_embeddings.case_id,
            'embeddingJson', teacher_case_embeddings.embedding_json
        )
        FROM teacher_case_embeddings
        INNER JOIN teacher_cases ON teacher_cases.id = teacher_case_embeddings.case_id
        WHERE teacher_cases.embedding_status = 'ready';
        "#,
    )?;

    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_teacher_case_embedding_json_line)
        .collect()
}

fn parse_teacher_case_embedding_json_line(
    line: &str,
) -> Result<StoredTeacherCaseEmbedding, AppError> {
    let row: TeacherCaseEmbeddingJsonRow = serde_json::from_str(line).map_err(|error| {
        AppError::with_detail(
            "CORPUS_EMBEDDING_PARSE_FAILED",
            "解析教师案例向量记录失败。",
            error.to_string(),
        )
    })?;
    let embedding = serde_json::from_str::<Vec<f64>>(&row.embedding_json).map_err(|error| {
        AppError::with_detail(
            "CORPUS_EMBEDDING_PARSE_FAILED",
            "解析教师案例向量失败。",
            error.to_string(),
        )
    })?;

    Ok(StoredTeacherCaseEmbedding {
        case_id: row.case_id,
        embedding,
    })
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
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| {
            AppError::with_detail(
                "ZHIPU_CLIENT_FAILED",
                "智谱 Embedding 客户端初始化失败。",
                error.to_string(),
            )
        })?;

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
            AppError::with_detail(
                "ZHIPU_EMBEDDING_REQUEST_FAILED",
                "智谱 Embedding 请求失败，请检查网络或 Base URL。",
                error.to_string(),
            )
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        AppError::with_detail(
            "ZHIPU_EMBEDDING_RESPONSE_READ_FAILED",
            "读取智谱 Embedding 响应失败。",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        return Err(AppError::with_detail(
            "ZHIPU_EMBEDDING_HTTP_ERROR",
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
    if !matches!(config.dimensions, 256 | 512 | 1024 | 2048) {
        return Err(AppError::new(
            "ZHIPU_DIMENSIONS_INVALID",
            "智谱 Embedding 维度必须是 256、512、1024 或 2048。",
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
        .replace('\n', " ")
        .replace('\r', " ")
}

fn run_sqlite_statement(db_path: &Path, sql: &str) -> Result<String, AppError> {
    let output = Command::new("sqlite3")
        .arg("-batch")
        .arg(db_path)
        .arg(sql)
        .output()
        .map_err(|error| {
            AppError::with_detail(
                "CORPUS_SQLITE_UNAVAILABLE",
                "无法启动 sqlite3，请确认系统 SQLite 可用。",
                error.to_string(),
            )
        })?;

    if !output.status.success() {
        return Err(AppError::with_detail(
            "CORPUS_SQLITE_FAILED",
            "教师案例库 SQLite 操作失败。",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeacherCaseJsonRow {
    id: String,
    original_text: String,
    revised_text: String,
    teacher_comment: String,
    scoring_preference: Option<String>,
    embedding_status: String,
    created_at: String,
    updated_at: String,
}

fn parse_teacher_case_json_line(line: &str) -> Result<TeacherCase, AppError> {
    let row: TeacherCaseJsonRow = serde_json::from_str(line).map_err(|error| {
        AppError::with_detail(
            "CORPUS_CASE_PARSE_FAILED",
            "解析教师案例失败。",
            error.to_string(),
        )
    })?;

    Ok(TeacherCase {
        id: row.id,
        original_text: row.original_text,
        revised_text: row.revised_text,
        teacher_comment: row.teacher_comment,
        scoring_preference: row.scoring_preference,
        embedding_status: EmbeddingStatus::from_str(&row.embedding_status),
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

fn sqlite_text_literal(value: &str) -> String {
    let temp_path =
        std::env::temp_dir().join(format!("ielts-corpus-sql-{}.txt", timestamp_nanos()));
    let write_result =
        fs::File::create(&temp_path).and_then(|mut file| file.write_all(value.as_bytes()));
    if write_result.is_err() {
        return "''".to_string();
    }

    let path_literal = temp_path.to_string_lossy().replace('\'', "''");
    let output = Command::new("sqlite3")
        .arg(":memory:")
        .arg(format!("SELECT quote(readfile('{path_literal}'));"))
        .output();
    let _ = fs::remove_file(temp_path);

    match output {
        Ok(output) if output.status.success() => {
            let blob_literal = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if blob_literal.is_empty() || blob_literal.eq_ignore_ascii_case("NULL") {
                "''".to_string()
            } else {
                format!("CAST({blob_literal} AS TEXT)")
            }
        }
        _ => "''".to_string(),
    }
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
    format!("teacher-case-{}", timestamp_nanos())
}

fn timestamp_string() -> String {
    timestamp_nanos().to_string()
}

fn timestamp_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("{name}-{}.sqlite3", timestamp_nanos()))
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

    #[test]
    fn creates_lists_updates_and_deletes_single_teacher_case() {
        let db_path = temp_db_path("teacher-case-crud");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");

        assert_eq!(created.embedding_status, EmbeddingStatus::Pending);
        assert_eq!(created.original_text, "I like English.");

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

        delete_teacher_case_at_path(&db_path, &created.id).expect("delete one case");
        let listed_after_delete = list_teacher_cases_at_path(&db_path).expect("list after delete");
        assert!(listed_after_delete.is_empty());

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn rejects_empty_required_teacher_case_fields() {
        let error = normalize_teacher_case_input(valid_input("   "))
            .expect_err("empty original should fail");
        assert_eq!(error.code, "CORPUS_CASE_INVALID");
    }

    #[test]
    fn returns_not_found_for_single_record_delete() {
        let db_path = temp_db_path("teacher-case-not-found");
        let error = delete_teacher_case_at_path(&db_path, "missing-case")
            .expect_err("missing case should fail");
        assert_eq!(error.code, "CORPUS_CASE_NOT_FOUND");

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn validates_zhipu_embedding_config_before_network_request() {
        let missing_key_error = validate_zhipu_embedding_config(&StoredZhipuConfig {
            api_key: None,
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions: 1024,
        })
        .expect_err("missing key should fail before network");
        assert_eq!(missing_key_error.code, "ZHIPU_KEY_MISSING");

        let invalid_dimensions_error = validate_zhipu_embedding_config(&StoredZhipuConfig {
            api_key: Some("zhipu-test".to_string()),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions: 768,
        })
        .expect_err("invalid dimensions should fail");
        assert_eq!(invalid_dimensions_error.code, "ZHIPU_DIMENSIONS_INVALID");
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
        let db_path = temp_db_path("teacher-case-embedding-storage");
        let created = create_teacher_case_at_path(&db_path, valid_input("I like English."))
            .expect("create case");
        let config = StoredZhipuConfig {
            api_key: Some("zhipu-test".to_string()),
            base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
            model: "embedding-3".to_string(),
            dimensions: 4,
        };

        upsert_teacher_case_embedding_at_path(
            &db_path,
            &created.id,
            &[1.0, 0.0, 0.0, 0.0],
            &config,
        )
        .expect("store embedding");
        set_teacher_case_embedding_status_at_path(&db_path, &created.id, EmbeddingStatus::Ready)
            .expect("ready status");
        let embeddings =
            list_ready_teacher_case_embeddings_at_path(&db_path).expect("list ready embeddings");
        assert_eq!(embeddings.len(), 1);
        assert_eq!(embeddings[0].case_id, created.id);
        assert_eq!(embeddings[0].embedding, vec![1.0, 0.0, 0.0, 0.0]);

        delete_teacher_case_embedding_at_path(&db_path, &created.id).expect("clear embedding");
        let embeddings_after_clear =
            list_ready_teacher_case_embeddings_at_path(&db_path).expect("list after clear");
        assert!(embeddings_after_clear.is_empty());

        let _ = std::fs::remove_file(db_path);
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
}
