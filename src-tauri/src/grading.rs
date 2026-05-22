use crate::{AppError, StoredDeepSeekConfig};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SpeakingPart {
    Part1,
    Part2,
    Part3,
}

impl SpeakingPart {
    fn label(&self) -> &'static str {
        match self {
            Self::Part1 => "IELTS Speaking Part 1",
            Self::Part2 => "IELTS Speaking Part 2",
            Self::Part3 => "IELTS Speaking Part 3",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GradeRequest {
    text: String,
    part: SpeakingPart,
    question: Option<String>,
    #[serde(default)]
    rag_examples: Vec<RagPromptExample>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RagPromptExample {
    #[serde(alias = "originalText")]
    original_text: String,
    #[serde(alias = "revisedText")]
    revised_text: String,
    #[serde(alias = "teacherComment")]
    teacher_comment: String,
    #[serde(default, alias = "scoringPreference")]
    scoring_preference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct GradeResult {
    overall_band: f64,
    sub_scores: SubScores,
    personal_style_comment: String,
    vocabulary_corrections: Vec<VocabularyCorrection>,
    reconstructed_essay: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub(crate) struct SubScores {
    FC: f64,
    LR: f64,
    GRA: f64,
    PR: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct VocabularyCorrection {
    original: String,
    suggested: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigValidationResult {
    pub(crate) ok: bool,
    pub(crate) api_key_configured: bool,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) service_reachable: bool,
    pub(crate) available_models: Vec<String>,
    pub(crate) message: String,
}

#[derive(Debug, Deserialize)]
struct DeepSeekResponse {
    choices: Vec<DeepSeekChoice>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekChoice {
    message: DeepSeekMessage,
}

#[derive(Debug, Deserialize)]
struct DeepSeekMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct DeepSeekModelsResponse {
    data: Vec<DeepSeekModelInfo>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekModelInfo {
    id: String,
}

pub(crate) async fn validate_deepseek_config(
    config: &StoredDeepSeekConfig,
) -> Result<ConfigValidationResult, AppError> {
    let api_key_configured = config
        .api_key
        .as_ref()
        .is_some_and(|key| !key.trim().is_empty());
    let base_url = config.base_url.trim().to_string();

    if !api_key_configured || base_url.is_empty() {
        return Ok(ConfigValidationResult {
            ok: false,
            api_key_configured,
            base_url,
            model: config.model.as_str().to_string(),
            service_reachable: false,
            available_models: vec![],
            message: if !api_key_configured {
                "请先在设置页配置 DeepSeek API Key。".to_string()
            } else {
                "DeepSeek Base URL 不能为空。".to_string()
            },
        });
    }

    let api_key = config
        .api_key
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "DEEPSEEK_KEY_MISSING",
                "请先在设置页配置 DeepSeek API Key。",
            )
        })?;
    let endpoint = models_endpoint(&config.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| {
            AppError::with_detail(
                "DEEPSEEK_CLIENT_FAILED",
                "DeepSeek 客户端初始化失败。",
                error.to_string(),
            )
        })?;
    let response = client
        .get(endpoint)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| {
            AppError::with_detail(
                "DEEPSEEK_CONNECTIVITY_FAILED",
                "DeepSeek 连通性测试失败，请检查网络或 Base URL。",
                error.to_string(),
            )
        })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        AppError::with_detail(
            "DEEPSEEK_RESPONSE_READ_FAILED",
            "读取 DeepSeek 连通性响应失败。",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        return Ok(ConfigValidationResult {
            ok: false,
            api_key_configured: true,
            base_url,
            model: config.model.as_str().to_string(),
            service_reachable: false,
            available_models: vec![],
            message: format!(
                "DeepSeek 连通性测试失败，服务返回状态 {}。",
                status.as_u16()
            ),
        });
    }

    let parsed: DeepSeekModelsResponse = serde_json::from_str(&body).map_err(|error| {
        AppError::with_detail(
            "DEEPSEEK_MODELS_RESPONSE_INVALID",
            "DeepSeek 模型列表响应格式无法解析。",
            format!("{}; body={}", error, summarize_for_debug(&body)),
        )
    })?;
    let available_models = parsed
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|model| !model.trim().is_empty())
        .collect::<Vec<_>>();
    let selected_model = config.model.as_str().to_string();
    let selected_model_available = available_models
        .iter()
        .any(|model| model == selected_model.as_str());

    Ok(ConfigValidationResult {
        ok: selected_model_available,
        api_key_configured: true,
        base_url,
        model: selected_model.clone(),
        service_reachable: true,
        message: if selected_model_available {
            format!("DeepSeek 连通性正常，当前模型 {selected_model} 可用。")
        } else {
            format!("DeepSeek 可连接，但当前模型 {selected_model} 不在可用模型列表中。")
        },
        available_models,
    })
}

pub(crate) async fn grade_speaking(
    config: &StoredDeepSeekConfig,
    request: GradeRequest,
) -> Result<GradeResult, AppError> {
    validate_grade_request(&request)?;

    let api_key = config
        .api_key
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::new(
                "DEEPSEEK_KEY_MISSING",
                "请先在设置页配置 DeepSeek API Key。",
            )
        })?;

    let endpoint = chat_completions_endpoint(&config.base_url)?;
    let system_prompt = build_system_prompt();
    let user_prompt = build_user_prompt(&request);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| {
            AppError::with_detail(
                "DEEPSEEK_CLIENT_FAILED",
                "DeepSeek 客户端初始化失败。",
                error.to_string(),
            )
        })?;

    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": config.model.as_str(),
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2
        }))
        .send()
        .await
        .map_err(|error| {
            AppError::with_detail(
                "DEEPSEEK_REQUEST_FAILED",
                "DeepSeek 请求失败，请检查网络或 Base URL。",
                error.to_string(),
            )
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        AppError::with_detail(
            "DEEPSEEK_RESPONSE_READ_FAILED",
            "读取 DeepSeek 响应失败。",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        return Err(AppError::with_detail(
            "DEEPSEEK_HTTP_ERROR",
            format!("DeepSeek 服务返回错误状态：{}。", status.as_u16()),
            summarize_for_debug(&body),
        ));
    }

    let parsed: DeepSeekResponse = serde_json::from_str(&body).map_err(|error| {
        AppError::with_detail(
            "DEEPSEEK_RESPONSE_INVALID",
            "DeepSeek 响应格式无法解析。",
            format!("{}; body={}", error, summarize_for_debug(&body)),
        )
    })?;

    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| {
            AppError::with_detail(
                "DEEPSEEK_RESPONSE_EMPTY",
                "DeepSeek 未返回批改内容。",
                summarize_for_debug(&body),
            )
        })?;

    parse_grade_result(content)
}

fn validate_grade_request(request: &GradeRequest) -> Result<(), AppError> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err(AppError::new("GRADE_TEXT_EMPTY", "请先输入口语回答文本。"));
    }

    if text.chars().count() < 20 {
        return Err(AppError::new(
            "GRADE_TEXT_TOO_SHORT",
            "口语回答文本过短，无法进行稳定评分。",
        ));
    }

    Ok(())
}

fn chat_completions_endpoint(base_url: &str) -> Result<String, AppError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::new(
            "DEEPSEEK_BASE_URL_EMPTY",
            "DeepSeek Base URL 不能为空。",
        ));
    }

    if trimmed.ends_with("/chat/completions") {
        Ok(trimmed.to_string())
    } else {
        Ok(format!("{trimmed}/chat/completions"))
    }
}

fn models_endpoint(base_url: &str) -> Result<String, AppError> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(AppError::new(
            "DEEPSEEK_BASE_URL_EMPTY",
            "DeepSeek Base URL 不能为空。",
        ));
    }

    if let Some(api_root) = trimmed.strip_suffix("/chat/completions") {
        Ok(format!("{api_root}/models"))
    } else {
        Ok(format!("{trimmed}/models"))
    }
}

fn build_system_prompt() -> &'static str {
    r#"You are an expert IELTS Speaking examiner and a pragmatic speaking coach.
Score the answer according to IELTS Speaking public band descriptors.
Return only a raw JSON object. Do not output Markdown. Do not use code fences.
The JSON must match this exact shape:
{
  "overall_band": number,
  "sub_scores": { "FC": number, "LR": number, "GRA": number, "PR": number },
  "personal_style_comment": string,
  "vocabulary_corrections": [
    { "original": string, "suggested": string, "reason": string }
  ],
  "reconstructed_essay": string
}
Use 0-9 scores. Use half-band increments when appropriate.
Explain vocabulary corrections with concrete reasons.
The reconstructed answer must keep the student's original meaning and must not invent personal experiences.
Do not reveal chain-of-thought. Write comments in Chinese, but keep corrected English examples in English."#
}

fn build_user_prompt(request: &GradeRequest) -> String {
    let question = request
        .question
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("未提供具体题目");

    let rag_block = build_rag_prompt_xml(&request.rag_examples);

    format!(
        "考试部分: {}\n题目: {}\n教师历史案例参考:\n{}\n\n学生回答:\n{}",
        request.part.label(),
        question,
        rag_block,
        request.text.trim()
    )
}

fn build_rag_prompt_xml(examples: &[RagPromptExample]) -> String {
    let formatted_examples = examples
        .iter()
        .filter_map(format_rag_prompt_example)
        .take(3)
        .collect::<Vec<_>>();

    if formatted_examples.is_empty() {
        return "无教师历史案例。".to_string();
    }

    format!(
        "<teacher_examples>\n{}\n</teacher_examples>",
        formatted_examples.join("\n")
    )
}

fn format_rag_prompt_example(example: &RagPromptExample) -> Option<String> {
    let original_text = clean_prompt_field(&example.original_text, 1_200);
    let revised_text = clean_prompt_field(&example.revised_text, 1_200);
    let teacher_comment = clean_prompt_field(&example.teacher_comment, 900);
    let scoring_preference = example
        .scoring_preference
        .as_ref()
        .map(|value| clean_prompt_field(value, 500))
        .filter(|value| !value.is_empty());

    if original_text.is_empty() || revised_text.is_empty() || teacher_comment.is_empty() {
        return None;
    }

    let scoring_preference_xml = scoring_preference
        .map(|value| {
            format!(
                "\n  <scoring_preference>{}</scoring_preference>",
                escape_xml_text(&value)
            )
        })
        .unwrap_or_default();

    Some(format!(
        "<example>\n  <original_text>{}</original_text>\n  <revised_text>{}</revised_text>\n  <teacher_comment>{}</teacher_comment>{}\n</example>",
        escape_xml_text(&original_text),
        escape_xml_text(&revised_text),
        escape_xml_text(&teacher_comment),
        scoring_preference_xml,
    ))
}

fn clean_prompt_field(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn escape_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn parse_grade_result(content: &str) -> Result<GradeResult, AppError> {
    let json_text = clean_json_object(content)?;
    let result: GradeResult = serde_json::from_str(&json_text).map_err(|error| {
        AppError::with_detail(
            "GRADE_RESULT_SCHEMA_INVALID",
            "模型返回内容不符合批改结果格式。",
            format!("{}; content={}", error, summarize_for_debug(content)),
        )
    })?;

    validate_grade_result(&result)?;
    Ok(result)
}

fn clean_json_object(content: &str) -> Result<String, AppError> {
    let mut cleaned = content.trim();

    if cleaned.starts_with("```") {
        cleaned = cleaned.trim_start_matches("```").trim();
        if let Some(rest) = cleaned.strip_prefix("json") {
            cleaned = rest.trim();
        }
        if let Some(rest) = cleaned.strip_suffix("```") {
            cleaned = rest.trim();
        }
    }

    let start = cleaned.find('{').ok_or_else(|| {
        AppError::with_detail(
            "GRADE_RESULT_JSON_MISSING",
            "模型返回内容中没有 JSON 对象。",
            summarize_for_debug(content),
        )
    })?;
    let end = cleaned.rfind('}').ok_or_else(|| {
        AppError::with_detail(
            "GRADE_RESULT_JSON_MISSING",
            "模型返回内容中没有完整 JSON 对象。",
            summarize_for_debug(content),
        )
    })?;

    if start >= end {
        return Err(AppError::with_detail(
            "GRADE_RESULT_JSON_INVALID",
            "模型返回 JSON 边界异常。",
            summarize_for_debug(content),
        ));
    }

    Ok(cleaned[start..=end].to_string())
}

fn validate_grade_result(result: &GradeResult) -> Result<(), AppError> {
    for (name, score) in [
        ("overall_band", result.overall_band),
        ("FC", result.sub_scores.FC),
        ("LR", result.sub_scores.LR),
        ("GRA", result.sub_scores.GRA),
        ("PR", result.sub_scores.PR),
    ] {
        if !(0.0..=9.0).contains(&score) || !score.is_finite() {
            return Err(AppError::new(
                "GRADE_RESULT_SCORE_INVALID",
                format!("{name} 分数必须在 0-9 范围内。"),
            ));
        }
    }

    if result.personal_style_comment.trim().is_empty() {
        return Err(AppError::new(
            "GRADE_RESULT_SCHEMA_INVALID",
            "模型返回结果缺少教师风格评语。",
        ));
    }

    if result.reconstructed_essay.trim().is_empty() {
        return Err(AppError::new(
            "GRADE_RESULT_SCHEMA_INVALID",
            "模型返回结果缺少重构示范。",
        ));
    }

    Ok(())
}

fn summarize_for_debug(value: &str) -> String {
    value
        .chars()
        .take(600)
        .collect::<String>()
        .replace('\n', " ")
        .replace('\r', " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_json() -> &'static str {
        r#"{
          "overall_band": 6.0,
          "sub_scores": { "FC": 6.0, "LR": 6.5, "GRA": 5.5, "PR": 6.0 },
          "personal_style_comment": "表达清楚，但需要减少重复。",
          "vocabulary_corrections": [
            { "original": "very happy event", "suggested": "memorable experience", "reason": "更自然具体。" }
          ],
          "reconstructed_essay": "When I was seven, I had a memorable experience..."
        }"#
    }

    #[test]
    fn cleans_markdown_wrapped_json() {
        let wrapped = format!("```json\n{}\n```", valid_json());
        let cleaned = clean_json_object(&wrapped).expect("json should be cleaned");
        assert!(cleaned.starts_with('{'));
        assert!(cleaned.ends_with('}'));
    }

    #[test]
    fn parses_valid_grade_result() {
        let result = parse_grade_result(valid_json()).expect("valid schema");
        assert_eq!(result.overall_band, 6.0);
        assert_eq!(result.sub_scores.LR, 6.5);
        assert_eq!(result.vocabulary_corrections.len(), 1);
    }

    #[test]
    fn rejects_score_outside_band_range() {
        let invalid = valid_json().replace("\"overall_band\": 6.0", "\"overall_band\": 10.0");
        let error = parse_grade_result(&invalid).expect_err("invalid score should fail");
        assert_eq!(error.code, "GRADE_RESULT_SCORE_INVALID");
    }

    #[test]
    fn rejects_missing_required_field() {
        let invalid = valid_json().replace(
            "\"personal_style_comment\": \"表达清楚，但需要减少重复。\",",
            "",
        );
        let error = parse_grade_result(&invalid).expect_err("missing field should fail");
        assert_eq!(error.code, "GRADE_RESULT_SCHEMA_INVALID");
    }

    #[test]
    fn prompt_contains_question_and_answer() {
        let prompt = build_user_prompt(&GradeRequest {
            text: "I got a bike when I was seven and I felt very happy.".to_string(),
            part: SpeakingPart::Part2,
            question: Some("Describe a happy event".to_string()),
            rag_examples: vec![],
        });

        assert!(prompt.contains("Describe a happy event"));
        assert!(prompt.contains("I got a bike"));
        assert!(prompt.contains("IELTS Speaking Part 2"));
    }

    #[test]
    fn prompt_uses_xml_rag_examples_and_escapes_content() {
        let prompt = build_user_prompt(&GradeRequest {
            text: "I got a bike when I was seven and I felt very happy.".to_string(),
            part: SpeakingPart::Part2,
            question: Some("Describe a happy event".to_string()),
            rag_examples: vec![RagPromptExample {
                original_text: "I <like> simple words & repeat them.".to_string(),
                revised_text: "I prefer precise vocabulary.".to_string(),
                teacher_comment: "Avoid \"very\" and add examples.".to_string(),
                scoring_preference: Some("重视 fluency > rare words".to_string()),
            }],
        });

        assert!(prompt.contains("<teacher_examples>"));
        assert!(prompt.contains("<example>"));
        assert!(prompt.contains("I &lt;like&gt; simple words &amp; repeat them."));
        assert!(prompt.contains("Avoid &quot;very&quot; and add examples."));
        assert!(prompt
            .contains("<scoring_preference>重视 fluency &gt; rare words</scoring_preference>"));
    }

    #[test]
    fn rag_prompt_limits_examples_to_three() {
        let examples = (0..5)
            .map(|index| RagPromptExample {
                original_text: format!("Original {index}"),
                revised_text: format!("Revised {index}"),
                teacher_comment: format!("Comment {index}"),
                scoring_preference: None,
            })
            .collect::<Vec<_>>();

        let xml = build_rag_prompt_xml(&examples);

        assert_eq!(xml.matches("<example>").count(), 3);
        assert!(xml.contains("Original 2"));
        assert!(!xml.contains("Original 3"));
    }

    #[test]
    fn rag_prompt_falls_back_when_examples_are_empty_after_cleaning() {
        let xml = build_rag_prompt_xml(&[RagPromptExample {
            original_text: " ".to_string(),
            revised_text: "Revised".to_string(),
            teacher_comment: "Comment".to_string(),
            scoring_preference: None,
        }]);

        assert_eq!(xml, "无教师历史案例。");
    }

    #[test]
    fn rag_prompt_truncates_long_fields() {
        let long_text = "a".repeat(1_500);
        let xml = build_rag_prompt_xml(&[RagPromptExample {
            original_text: long_text,
            revised_text: "Revised".to_string(),
            teacher_comment: "Comment".to_string(),
            scoring_preference: None,
        }]);

        let extracted = xml
            .split("<original_text>")
            .nth(1)
            .and_then(|value| value.split("</original_text>").next())
            .expect("original text tag");
        assert_eq!(extracted.chars().count(), 1_200);
    }

    #[test]
    fn builds_models_endpoint_from_api_root() {
        let endpoint =
            models_endpoint("https://api.deepseek.com").expect("models endpoint should build");

        assert_eq!(endpoint, "https://api.deepseek.com/models");
    }

    #[test]
    fn builds_models_endpoint_from_chat_completions_endpoint() {
        let endpoint = models_endpoint("https://api.deepseek.com/chat/completions")
            .expect("models endpoint should build");

        assert_eq!(endpoint, "https://api.deepseek.com/models");
    }
}
