use serde::Serialize;

const CLOUD_REQUEST_ID_HEADERS: [&str; 5] = [
    "apim-request-id",
    "x-ms-request-id",
    "x-request-id",
    "request-id",
    "x-correlation-id",
];
const MAX_REQUEST_ID_LENGTH: usize = 128;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
}

impl AppError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            status: None,
            request_id: None,
        }
    }

    /// Compatibility constructor for internal failures. The underlying detail is
    /// deliberately discarded so filesystem paths, request URLs, response bodies,
    /// and user content can never cross the IPC boundary.
    pub(crate) fn with_detail(
        code: &'static str,
        message: impl Into<String>,
        _detail: impl Into<String>,
    ) -> Self {
        Self::new(code, message)
    }

    pub(crate) fn with_status(code: &'static str, message: impl Into<String>, status: u16) -> Self {
        Self {
            code,
            message: message.into(),
            status: Some(status),
            request_id: None,
        }
    }

    pub(crate) fn with_request_id(mut self, request_id: Option<String>) -> Self {
        self.request_id = request_id.and_then(|value| sanitize_request_id(&value));
        self
    }
}

pub(crate) fn cloud_request_id(headers: &reqwest::header::HeaderMap) -> Option<String> {
    CLOUD_REQUEST_ID_HEADERS.iter().find_map(|header_name| {
        headers
            .get(*header_name)
            .and_then(|value| value.to_str().ok())
            .and_then(sanitize_request_id)
    })
}

fn sanitize_request_id(request_id: &str) -> Option<String> {
    let normalized_request_id = request_id.trim();
    let contains_only_allowed_characters = normalized_request_id.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
    });

    if normalized_request_id.is_empty()
        || normalized_request_id.len() > MAX_REQUEST_ID_LENGTH
        || !contains_only_allowed_characters
    {
        return None;
    }

    Some(normalized_request_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_serializes_internal_detail() {
        let error = AppError::with_detail(
            "REQUEST_FAILED",
            "请求失败。",
            "secret response body and /private/path",
        );
        let serialized = serde_json::to_string(&error).expect("serialize app error");

        assert_eq!(
            serialized,
            r#"{"code":"REQUEST_FAILED","message":"请求失败。"}"#
        );
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("private"));
    }

    #[test]
    fn serializes_only_whitelisted_transport_metadata() {
        let error = AppError::with_status("HTTP_ERROR", "服务返回错误。", 429)
            .with_request_id(Some(" request-123 ".to_string()));
        let serialized = serde_json::to_value(error).expect("serialize app error");

        assert_eq!(serialized["status"], 429);
        assert_eq!(serialized["requestId"], "request-123");
        assert!(serialized.get("detail").is_none());
    }

    #[test]
    fn rejects_request_ids_with_path_separators_or_non_ascii_characters() {
        for unsafe_request_id in [
            "../../private/token",
            r"C:\\private\\token",
            "request id",
            "请求-123",
        ] {
            let error = AppError::new("HTTP_ERROR", "服务返回错误。")
                .with_request_id(Some(unsafe_request_id.to_string()));
            assert_eq!(error.request_id, None);
        }
    }

    #[test]
    fn extracts_all_supported_cloud_request_id_headers_in_priority_order() {
        for header_name in CLOUD_REQUEST_ID_HEADERS {
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::HeaderName::from_static(header_name),
                reqwest::header::HeaderValue::from_static("request-123:region"),
            );

            assert_eq!(
                cloud_request_id(&headers).as_deref(),
                Some("request-123:region")
            );
        }

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-request-id",
            reqwest::header::HeaderValue::from_static("fallback-request"),
        );
        headers.insert(
            "apim-request-id",
            reqwest::header::HeaderValue::from_static("preferred-request"),
        );
        assert_eq!(
            cloud_request_id(&headers).as_deref(),
            Some("preferred-request")
        );
    }

    #[test]
    fn skips_unsafe_higher_priority_request_id_header() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "apim-request-id",
            reqwest::header::HeaderValue::from_static("../unsafe"),
        );
        headers.insert(
            "x-ms-request-id",
            reqwest::header::HeaderValue::from_static("safe-request"),
        );

        assert_eq!(cloud_request_id(&headers).as_deref(), Some("safe-request"));
    }
}
