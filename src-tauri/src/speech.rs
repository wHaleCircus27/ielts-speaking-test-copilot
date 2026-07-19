use crate::endpoints::{
    cloud_http_client_builder, normalize_azure_region, read_bounded_response_body,
};
use crate::errors::cloud_request_id;
use crate::{AppError, StoredAzureConfig};
use serde::Serialize;
use std::time::Duration;
use url::Url;

const MAX_AZURE_TOKEN_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AzureConfigValidationResult {
    pub(crate) ok: bool,
    pub(crate) key_configured: bool,
    pub(crate) region: String,
    pub(crate) language: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AzureSpeechToken {
    token: String,
    region: String,
    language: String,
}

pub(crate) fn validate_azure_config(config: &StoredAzureConfig) -> AzureConfigValidationResult {
    let key_configured = config
        .key
        .as_ref()
        .is_some_and(|key| !key.trim().is_empty());
    let normalized_region = normalize_azure_region(&config.region);
    let region = normalized_region
        .as_ref()
        .cloned()
        .unwrap_or_else(|_| config.region.trim().to_string());
    let language = config.language.trim().to_string();
    let ok = config.enabled
        && config.disclosure_accepted_version == Some(1)
        && key_configured
        && normalized_region.is_ok()
        && !language.is_empty();

    AzureConfigValidationResult {
        ok,
        key_configured,
        region: region.clone(),
        language: language.clone(),
        message: if !config.enabled {
            "Azure Speech 云服务当前未启用。".to_string()
        } else if config.disclosure_accepted_version != Some(1) {
            "请先接受当前云服务数据流说明。".to_string()
        } else if ok {
            "Azure Speech 配置可用。".to_string()
        } else if !key_configured {
            "请先在设置页配置 Azure Key。".to_string()
        } else if normalized_region.is_err() {
            "Azure region 格式无效。".to_string()
        } else {
            "Azure language 不能为空。".to_string()
        },
    }
}

pub(crate) async fn issue_azure_speech_token(
    config: &StoredAzureConfig,
) -> Result<AzureSpeechToken, AppError> {
    let validation = validate_azure_config(config);
    if !validation.ok {
        return Err(AppError::new("AZURE_CONFIG_INVALID", validation.message));
    }

    let key = config
        .key
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::new("AZURE_KEY_MISSING", "请先在设置页配置 Azure Key。"))?;
    let token_endpoint = azure_token_endpoint(&validation.region)?;
    let client = cloud_http_client_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| {
            AppError::new(
                "AZURE_TOKEN_CLIENT_FAILED",
                "Azure Speech token 客户端初始化失败。",
            )
        })?;
    let response = client
        .post(token_endpoint)
        .header("Ocp-Apim-Subscription-Key", key)
        .send()
        .await
        .map_err(|_| {
            AppError::new(
                "AZURE_TOKEN_REQUEST_FAILED",
                "Azure Speech token 请求失败，请检查网络和 region。",
            )
        })?;
    let status = response.status();
    let request_id = cloud_request_id(response.headers());

    if !status.is_success() {
        return Err(AppError::with_status(
            "AZURE_TOKEN_REQUEST_REJECTED",
            format!(
                "Azure Speech token 请求失败，服务返回状态 {}。",
                status.as_u16()
            ),
            status.as_u16(),
        )
        .with_request_id(request_id));
    }

    let bounded_body = read_bounded_response_body(
        response,
        MAX_AZURE_TOKEN_RESPONSE_BYTES,
        "AZURE_TOKEN_RESPONSE_TOO_LARGE",
        "Azure Speech token 响应超过大小限制。",
        |_| {
            AppError::new(
                "AZURE_TOKEN_RESPONSE_READ_FAILED",
                "读取 Azure Speech token 响应失败。",
            )
        },
    )
    .await?;
    let request_id = bounded_body.request_id;
    let token = String::from_utf8(bounded_body.bytes).map_err(|_| {
        AppError::new(
            "AZURE_TOKEN_RESPONSE_INVALID",
            "Azure Speech token 响应格式无效。",
        )
        .with_request_id(request_id.clone())
    })?;

    if token.trim().is_empty() {
        return Err(
            AppError::new("AZURE_TOKEN_EMPTY", "Azure Speech token 响应为空。")
                .with_request_id(request_id),
        );
    }

    Ok(AzureSpeechToken {
        token,
        region: validation.region,
        language: validation.language,
    })
}

fn azure_token_endpoint(region: &str) -> Result<Url, AppError> {
    let normalized_region = normalize_azure_region(region)?;
    let expected_host = format!("{normalized_region}.api.cognitive.microsoft.com");
    let mut endpoint = Url::parse("https://api.cognitive.microsoft.com").map_err(|_| {
        AppError::new(
            "AZURE_ENDPOINT_INVALID",
            "无法构造 Azure Speech token endpoint。",
        )
    })?;
    endpoint.set_host(Some(&expected_host)).map_err(|_| {
        AppError::new(
            "AZURE_ENDPOINT_INVALID",
            "无法构造 Azure Speech token endpoint。",
        )
    })?;
    endpoint.set_path("/sts/v1.0/issueToken");

    if endpoint.scheme() != "https" || endpoint.host_str() != Some(expected_host.as_str()) {
        return Err(AppError::new(
            "AZURE_ENDPOINT_INVALID",
            "Azure Speech token endpoint 主机校验失败。",
        ));
    }
    Ok(endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_missing_azure_key_without_leaking_secret() {
        let result = validate_azure_config(&StoredAzureConfig {
            key: None,
            enabled: true,
            region: "eastasia".to_string(),
            language: "en-US".to_string(),
            credential_status: crate::config::CredentialStatus::Missing,
            disclosure_accepted_version: Some(1),
        });

        assert!(!result.ok);
        assert!(!result.key_configured);
        assert_eq!(result.message, "请先在设置页配置 Azure Key。");
    }

    #[test]
    fn validates_complete_azure_config() {
        let result = validate_azure_config(&StoredAzureConfig {
            key: Some("secret-key".to_string()),
            enabled: true,
            region: "EastAsia".to_string(),
            language: "en-US".to_string(),
            credential_status: crate::config::CredentialStatus::Configured,
            disclosure_accepted_version: Some(1),
        });

        assert!(result.ok);
        assert!(result.key_configured);
        assert_eq!(result.region, "eastasia");
        assert_eq!(result.language, "en-US");
        assert!(!result.message.contains("secret-key"));
    }

    #[test]
    fn builds_region_scoped_token_endpoint() {
        let endpoint = azure_token_endpoint("eastasia").expect("endpoint");

        assert_eq!(
            endpoint.as_str(),
            "https://eastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken"
        );
    }

    #[test]
    fn rejects_region_that_could_change_azure_host() {
        let error = azure_token_endpoint("eastasia.example.com")
            .expect_err("invalid region must be rejected");

        assert_eq!(error.code, "AZURE_REGION_INVALID");
    }

    #[test]
    fn disabled_azure_is_not_reported_as_ready() {
        let result = validate_azure_config(&StoredAzureConfig {
            key: Some("must-not-be-used".to_string()),
            enabled: false,
            region: "eastasia".to_string(),
            language: "en-US".to_string(),
            credential_status: crate::config::CredentialStatus::Configured,
            disclosure_accepted_version: Some(1),
        });

        assert!(!result.ok);
        assert_eq!(result.message, "Azure Speech 云服务当前未启用。");
    }
}
