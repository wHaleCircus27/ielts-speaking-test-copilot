use crate::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
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

    get_teacher_case_at_path(db_path, id)
}

fn delete_teacher_case_at_path(db_path: &Path, id: &str) -> Result<(), AppError> {
    initialize_teacher_cases_schema(db_path)?;
    get_teacher_case_at_path(db_path, id)?;
    let sql = format!(
        "DELETE FROM teacher_cases WHERE id = {};",
        sqlite_text_literal(id.trim())
    );
    run_sqlite_statement(db_path, &sql)?;
    Ok(())
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
    let temp_path = std::env::temp_dir().join(format!("ielts-corpus-sql-{}.txt", timestamp_nanos()));
    let write_result = fs::File::create(&temp_path)
        .and_then(|mut file| file.write_all(value.as_bytes()));
    if write_result.is_err() {
        return "''".to_string();
    }

    let path_literal = temp_path
        .to_string_lossy()
        .replace('\'', "''");
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
        return Err(AppError::new(
            "CORPUS_CASE_INVALID",
            "教师评语不能为空。",
        ));
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
        let created =
            create_teacher_case_at_path(&db_path, valid_input("I like English.")).expect("create case");

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
        let error =
            normalize_teacher_case_input(valid_input("   ")).expect_err("empty original should fail");
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
}
