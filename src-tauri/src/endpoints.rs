use crate::errors::{cloud_request_id, AppError};
use reqwest::Url;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NormalizedCloudEndpoint {
    pub(crate) base_url: String,
    pub(crate) binding: String,
    pub(crate) url: Url,
}

pub(crate) struct BoundedResponseBody {
    pub(crate) bytes: Vec<u8>,
    pub(crate) request_id: Option<String>,
}

pub(crate) fn cloud_http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
}

pub(crate) async fn read_bounded_response_body<F>(
    mut response: reqwest::Response,
    maximum_bytes: usize,
    too_large_code: &'static str,
    too_large_message: &'static str,
    read_failed_error: F,
) -> Result<BoundedResponseBody, AppError>
where
    F: Fn(&reqwest::Error) -> AppError,
{
    let request_id = cloud_request_id(response.headers());
    if response
        .content_length()
        .is_some_and(|content_length| content_length > maximum_bytes as u64)
    {
        return Err(AppError::new(too_large_code, too_large_message).with_request_id(request_id));
    }

    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .and_then(|content_length| usize::try_from(content_length).ok())
            .unwrap_or_default()
            .min(maximum_bytes),
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| read_failed_error(&error).with_request_id(request_id.clone()))?
    {
        let accumulated_length = bytes
            .len()
            .checked_add(chunk.len())
            .filter(|length| *length <= maximum_bytes)
            .ok_or_else(|| {
                AppError::new(too_large_code, too_large_message).with_request_id(request_id.clone())
            })?;
        debug_assert!(accumulated_length <= maximum_bytes);
        bytes.extend_from_slice(&chunk);
    }

    Ok(BoundedResponseBody { bytes, request_id })
}

pub(crate) fn normalize_cloud_base_url(
    raw_base_url: &str,
    allow_insecure_localhost: bool,
    service_name: &str,
) -> Result<NormalizedCloudEndpoint, AppError> {
    let mut parsed = Url::parse(raw_base_url.trim()).map_err(|_| {
        AppError::new(
            "CLOUD_ENDPOINT_INVALID",
            format!("{service_name} Base URL 格式无效。"),
        )
    })?;

    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(AppError::new(
            "CLOUD_ENDPOINT_UNSAFE",
            format!("{service_name} Base URL 不能包含用户信息、查询参数或片段。"),
        ));
    }

    let host = parsed.host_str().ok_or_else(|| {
        AppError::new(
            "CLOUD_ENDPOINT_INVALID",
            format!("{service_name} Base URL 缺少主机名。"),
        )
    })?;
    let host_is_loopback = is_loopback_host(host);
    if is_disallowed_ip_host(host) && !host_is_loopback {
        return Err(AppError::new(
            "CLOUD_ENDPOINT_PRIVATE_IP",
            format!("{service_name} Base URL 不允许使用非 loopback 的私网 IP。"),
        ));
    }

    match parsed.scheme() {
        "https" => {}
        "http" if host_is_loopback && allow_insecure_localhost => {}
        "http" if host_is_loopback => {
            return Err(AppError::new(
                "CLOUD_ENDPOINT_INSECURE_LOCALHOST_DISABLED",
                format!("{service_name} 本机 HTTP 端点需要显式允许不安全 localhost。"),
            ));
        }
        "http" => {
            return Err(AppError::new(
                "CLOUD_ENDPOINT_HTTPS_REQUIRED",
                format!("{service_name} 非本机端点必须使用 HTTPS。"),
            ));
        }
        _ => {
            return Err(AppError::new(
                "CLOUD_ENDPOINT_SCHEME_INVALID",
                format!("{service_name} Base URL 只允许 HTTP(S)。"),
            ));
        }
    }

    let normalized_path = parsed.path().trim_end_matches('/').to_string();
    parsed.set_path(if normalized_path.is_empty() {
        "/"
    } else {
        &normalized_path
    });
    let binding = parsed.origin().ascii_serialization();
    let base_url = parsed.as_str().trim_end_matches('/').to_string();

    Ok(NormalizedCloudEndpoint {
        base_url,
        binding,
        url: parsed,
    })
}

pub(crate) fn endpoint_with_terminal_path(
    mut endpoint: Url,
    replaced_terminal_path: Option<&[&str]>,
    required_terminal_path: &[&str],
    service_name: &str,
) -> Result<Url, AppError> {
    let current_path_segments = endpoint
        .path_segments()
        .ok_or_else(|| endpoint_path_error(service_name))?
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if path_ends_with(&current_path_segments, required_terminal_path) {
        return Ok(endpoint);
    }

    let replaced_segment_count = replaced_terminal_path
        .filter(|terminal_path| path_ends_with(&current_path_segments, terminal_path))
        .map_or(0, |terminal_path| terminal_path.len());
    let mut path_segments = endpoint
        .path_segments_mut()
        .map_err(|_| endpoint_path_error(service_name))?;
    path_segments.pop_if_empty();
    for _ in 0..replaced_segment_count {
        path_segments.pop();
    }
    path_segments.extend(required_terminal_path.iter().copied());
    drop(path_segments);

    Ok(endpoint)
}

fn path_ends_with(current_path_segments: &[String], terminal_path: &[&str]) -> bool {
    current_path_segments.len() >= terminal_path.len()
        && current_path_segments[current_path_segments.len() - terminal_path.len()..]
            .iter()
            .map(String::as_str)
            .eq(terminal_path.iter().copied())
}

fn endpoint_path_error(service_name: &str) -> AppError {
    AppError::new(
        "CLOUD_ENDPOINT_PATH_INVALID",
        format!("无法构造 {service_name} API endpoint。"),
    )
}

pub(crate) fn normalize_azure_region(raw_region: &str) -> Result<String, AppError> {
    let normalized_region = raw_region.trim().to_ascii_lowercase();
    let mut characters = normalized_region.chars();
    let valid_first_character = characters
        .next()
        .is_some_and(|value| value.is_ascii_lowercase());
    let valid_remaining_characters =
        characters.all(|value| value.is_ascii_lowercase() || value.is_ascii_digit());

    if !(2..=32).contains(&normalized_region.len())
        || !valid_first_character
        || !valid_remaining_characters
    {
        return Err(AppError::new(
            "AZURE_REGION_INVALID",
            "Azure region 必须以小写字母开头，且仅包含 2-32 位小写字母或数字。",
        ));
    }

    Ok(normalized_region)
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || unbracket_ipv6_host(host)
            .parse::<IpAddr>()
            .is_ok_and(is_loopback_ip)
}

fn is_loopback_ip(ip_address: IpAddr) -> bool {
    match ip_address {
        IpAddr::V4(ipv4_address) => ipv4_address.is_loopback(),
        IpAddr::V6(ipv6_address) => {
            ipv6_address.is_loopback()
                || ipv6_address
                    .to_ipv4_mapped()
                    .is_some_and(|ipv4_address| ipv4_address.is_loopback())
        }
    }
}

fn is_disallowed_ip_host(host: &str) -> bool {
    match unbracket_ipv6_host(host).parse::<IpAddr>() {
        Ok(IpAddr::V4(ip_address)) => is_disallowed_ipv4(ip_address),
        Ok(IpAddr::V6(ip_address)) => is_disallowed_ipv6(ip_address),
        Err(_) => false,
    }
}

fn unbracket_ipv6_host(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
}

fn is_disallowed_ipv4(ip_address: Ipv4Addr) -> bool {
    ip_address.is_private()
        || ip_address.is_link_local()
        || ip_address.is_unspecified()
        || ip_address.is_broadcast()
        || ip_address.is_multicast()
}

fn is_disallowed_ipv6(ip_address: Ipv6Addr) -> bool {
    ip_address.to_ipv4_mapped().is_some_and(is_disallowed_ipv4)
        || ip_address.is_unique_local()
        || ip_address.is_unicast_link_local()
        || ip_address.is_unspecified()
        || ip_address.is_multicast()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    fn spawn_single_response_server(response: Vec<u8>) -> (Url, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind response listener");
        let address = listener.local_addr().expect("response listener address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept response request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set response read timeout");
            let mut request_buffer = [0_u8; 1_024];
            let _ = stream
                .read(&mut request_buffer)
                .expect("read response request");
            let _ = stream.write_all(&response);
        });
        let url = Url::parse(&format!("http://{address}/response")).expect("response URL");
        (url, server)
    }

    fn read_test_response(url: Url, maximum_bytes: usize) -> Result<BoundedResponseBody, AppError> {
        let request_task = tauri::async_runtime::spawn(async move {
            let client = cloud_http_client_builder()
                .timeout(Duration::from_secs(2))
                .build()
                .expect("build bounded response client");
            let response = client.get(url).send().await.expect("receive test response");
            read_bounded_response_body(
                response,
                maximum_bytes,
                "TEST_RESPONSE_TOO_LARGE",
                "测试响应超过大小限制。",
                |_| AppError::new("TEST_RESPONSE_READ_FAILED", "读取测试响应失败。"),
            )
            .await
        });
        tauri::async_runtime::block_on(request_task).expect("join bounded response task")
    }

    #[test]
    fn normalizes_https_endpoint_and_origin_binding() {
        let endpoint =
            normalize_cloud_base_url(" https://API.Example.com:443/v1/ ", false, "测试服务")
                .expect("valid endpoint");

        assert_eq!(endpoint.base_url, "https://api.example.com/v1");
        assert_eq!(endpoint.binding, "https://api.example.com");
    }

    #[test]
    fn rejects_credentials_query_and_fragment() {
        for raw_url in [
            "https://user@example.com/v1",
            "https://example.com/v1?token=value",
            "https://example.com/v1#fragment",
        ] {
            let error = normalize_cloud_base_url(raw_url, false, "测试服务")
                .expect_err("unsafe endpoint must be rejected");
            assert_eq!(error.code, "CLOUD_ENDPOINT_UNSAFE");
        }
    }

    #[test]
    fn permits_http_only_for_explicit_loopback() {
        assert!(normalize_cloud_base_url("http://localhost:8080/v1", true, "测试服务").is_ok());
        assert!(normalize_cloud_base_url("http://127.0.0.1:8080/v1", true, "测试服务").is_ok());

        let disabled = normalize_cloud_base_url("http://localhost:8080/v1", false, "测试服务")
            .expect_err("explicit opt-in is required");
        assert_eq!(disabled.code, "CLOUD_ENDPOINT_INSECURE_LOCALHOST_DISABLED");

        let remote = normalize_cloud_base_url("http://example.com/v1", true, "测试服务")
            .expect_err("remote HTTP is never allowed");
        assert_eq!(remote.code, "CLOUD_ENDPOINT_HTTPS_REQUIRED");
    }

    #[test]
    fn rejects_non_loopback_private_ip() {
        for raw_url in [
            "https://10.0.0.1/v1",
            "https://192.168.1.20/v1",
            "https://[fd00::1]/v1",
            "https://[::ffff:10.0.0.1]/v1",
        ] {
            let error = normalize_cloud_base_url(raw_url, false, "测试服务")
                .expect_err("private IP must be rejected");
            assert_eq!(error.code, "CLOUD_ENDPOINT_PRIVATE_IP");
        }
    }

    #[test]
    fn validates_and_lowercases_azure_region() {
        assert_eq!(
            normalize_azure_region(" EastAsia ").expect("region"),
            "eastasia"
        );
        for invalid_region in ["a", "east-asia", "1eastasia", "east_asia", ""] {
            assert!(normalize_azure_region(invalid_region).is_err());
        }
    }

    #[test]
    fn appends_and_replaces_terminal_path_segments_without_string_concatenation() {
        let base_endpoint = Url::parse("https://api.example.com/v1").expect("base endpoint");
        let chat_endpoint =
            endpoint_with_terminal_path(base_endpoint, None, &["chat", "completions"], "测试服务")
                .expect("chat endpoint");
        assert_eq!(
            chat_endpoint.as_str(),
            "https://api.example.com/v1/chat/completions"
        );

        let models_endpoint = endpoint_with_terminal_path(
            chat_endpoint,
            Some(&["chat", "completions"]),
            &["models"],
            "测试服务",
        )
        .expect("models endpoint");
        assert_eq!(
            models_endpoint.as_str(),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn does_not_duplicate_existing_terminal_path() {
        let endpoint =
            Url::parse("https://api.example.com/v1/embeddings").expect("embeddings endpoint");
        let endpoint = endpoint_with_terminal_path(endpoint, None, &["embeddings"], "测试服务")
            .expect("embeddings endpoint");

        assert_eq!(endpoint.as_str(), "https://api.example.com/v1/embeddings");
    }

    #[test]
    fn rejects_oversized_response_from_content_length_without_leaking_body() {
        let private_body = "private-response-body";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{private_body}",
            private_body.len()
        );
        let (url, server) = spawn_single_response_server(response.into_bytes());
        let private_url = url.to_string();

        let error = match read_test_response(url, 4) {
            Err(error) => error,
            Ok(_) => panic!("content length must be bounded"),
        };
        server.join().expect("join content length server");
        let serialized = serde_json::to_string(&error).expect("serialize bounded response error");

        assert_eq!(error.code, "TEST_RESPONSE_TOO_LARGE");
        assert!(!serialized.contains(private_body));
        assert!(!serialized.contains(&private_url));
    }

    #[test]
    fn rejects_oversized_chunked_response_without_content_length() {
        let private_body = "private-response-body";
        let response = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:X}\r\n{private_body}\r\n0\r\n\r\n",
            private_body.len()
        );
        let (url, server) = spawn_single_response_server(response.into_bytes());
        let private_url = url.to_string();

        let error = match read_test_response(url, 4) {
            Err(error) => error,
            Ok(_) => panic!("chunked body must be bounded"),
        };
        server.join().expect("join chunked response server");
        let serialized = serde_json::to_string(&error).expect("serialize bounded response error");

        assert_eq!(error.code, "TEST_RESPONSE_TOO_LARGE");
        assert!(!serialized.contains(private_body));
        assert!(!serialized.contains(&private_url));
    }

    #[test]
    fn cloud_http_client_never_follows_loopback_redirect() {
        let redirect_target_listener =
            TcpListener::bind("127.0.0.1:0").expect("bind redirect target listener");
        redirect_target_listener
            .set_nonblocking(true)
            .expect("make redirect target listener nonblocking");
        let redirect_target_address = redirect_target_listener
            .local_addr()
            .expect("redirect target address");

        let redirect_source_listener =
            TcpListener::bind("127.0.0.1:0").expect("bind redirect source listener");
        let redirect_source_address = redirect_source_listener
            .local_addr()
            .expect("redirect source address");
        let redirect_server = thread::spawn(move || {
            let (mut stream, _) = redirect_source_listener
                .accept()
                .expect("accept source request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set source read timeout");
            let mut request_buffer = [0_u8; 1_024];
            let _ = stream
                .read(&mut request_buffer)
                .expect("read source request");
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{redirect_target_address}/redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream
                .write_all(response.as_bytes())
                .expect("write redirect response");
        });

        let client = cloud_http_client_builder()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("build cloud client");
        let source_url =
            Url::parse(&format!("http://{redirect_source_address}/source")).expect("source URL");
        let request_task =
            tauri::async_runtime::spawn(async move { client.get(source_url).send().await });
        let response = tauri::async_runtime::block_on(request_task)
            .expect("join cloud request task")
            .expect("receive redirect response");
        redirect_server.join().expect("join redirect server");

        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        thread::sleep(Duration::from_millis(50));
        let redirect_target_connection = redirect_target_listener.accept();
        assert!(matches!(
            redirect_target_connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
        ));
    }
}
