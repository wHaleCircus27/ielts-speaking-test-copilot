use crate::{AppError, StoredAzureConfig};
use serde::Serialize;
use std::time::Duration;

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
    let region = config.region.trim().to_string();
    let language = config.language.trim().to_string();
    let ok = key_configured && !region.is_empty() && !language.is_empty();

    AzureConfigValidationResult {
        ok,
        key_configured,
        region: region.clone(),
        language: language.clone(),
        message: if ok {
            "Azure Speech 配置可用。".to_string()
        } else if !key_configured {
            "请先在设置页配置 Azure Key。".to_string()
        } else if region.is_empty() {
            "Azure region 不能为空。".to_string()
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| {
            AppError::with_detail(
                "AZURE_TOKEN_CLIENT_FAILED",
                "Azure Speech token 客户端初始化失败。",
                error.to_string(),
            )
        })?;
    let response = client
        .post(token_endpoint)
        .header("Ocp-Apim-Subscription-Key", key)
        .send()
        .await
        .map_err(|error| {
            AppError::with_detail(
                "AZURE_TOKEN_REQUEST_FAILED",
                "Azure Speech token 请求失败，请检查网络和 region。",
                error.to_string(),
            )
        })?;
    let status = response.status();
    let token = response.text().await.map_err(|error| {
        AppError::with_detail(
            "AZURE_TOKEN_RESPONSE_READ_FAILED",
            "读取 Azure Speech token 响应失败。",
            error.to_string(),
        )
    })?;

    if !status.is_success() {
        return Err(AppError::new(
            "AZURE_TOKEN_REQUEST_REJECTED",
            format!(
                "Azure Speech token 请求失败，服务返回状态 {}。",
                status.as_u16()
            ),
        ));
    }

    if token.trim().is_empty() {
        return Err(AppError::new(
            "AZURE_TOKEN_EMPTY",
            "Azure Speech token 响应为空。",
        ));
    }

    Ok(AzureSpeechToken {
        token,
        region: validation.region,
        language: validation.language,
    })
}

fn azure_token_endpoint(region: &str) -> Result<String, AppError> {
    let normalized_region = region.trim();
    if normalized_region.is_empty() {
        return Err(AppError::new(
            "AZURE_REGION_EMPTY",
            "Azure region 不能为空。",
        ));
    }

    Ok(format!(
        "https://{normalized_region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_missing_azure_key_without_leaking_secret() {
        let result = validate_azure_config(&StoredAzureConfig {
            key: None,
            region: "eastasia".to_string(),
            language: "en-US".to_string(),
        });

        assert!(!result.ok);
        assert!(!result.key_configured);
        assert_eq!(result.message, "请先在设置页配置 Azure Key。");
    }

    #[test]
    fn validates_complete_azure_config() {
        let result = validate_azure_config(&StoredAzureConfig {
            key: Some("secret-key".to_string()),
            region: "eastasia".to_string(),
            language: "en-US".to_string(),
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
            endpoint,
            "https://eastasia.api.cognitive.microsoft.com/sts/v1.0/issueToken"
        );
    }
}
