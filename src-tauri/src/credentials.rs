use crate::errors::AppError;
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "com.local.ielts-speaking-test-copilot";
const KEYCHAIN_ITEM_NOT_FOUND: i32 = -25_300;
const CREDENTIAL_PAYLOAD_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum CredentialAccount {
    DeepSeek,
    Zhipu,
    Azure,
}

impl CredentialAccount {
    fn as_str(self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek",
            Self::Zhipu => "zhipu",
            Self::Azure => "azure",
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoredCredential {
    version: u8,
    pub(crate) secret: String,
    pub(crate) binding: String,
}

pub(crate) struct CredentialRollback {
    account: CredentialAccount,
    previous_value: Option<Vec<u8>>,
}

pub(crate) trait CredentialBackend {
    fn read(&mut self, account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError>;
    fn write(&mut self, account: CredentialAccount, value: &[u8]) -> Result<(), AppError>;
    fn delete(&mut self, account: CredentialAccount) -> Result<(), AppError>;
}

pub(crate) struct SystemCredentialBackend;

impl CredentialBackend for SystemCredentialBackend {
    fn read(&mut self, account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
        read_raw_credential(account)
    }

    fn write(&mut self, account: CredentialAccount, value: &[u8]) -> Result<(), AppError> {
        write_raw_credential(account, value)
    }

    fn delete(&mut self, account: CredentialAccount) -> Result<(), AppError> {
        delete_raw_credential(account)
    }
}

pub(crate) fn read_credential_with_backend<B: CredentialBackend>(
    backend: &mut B,
    account: CredentialAccount,
) -> Result<Option<StoredCredential>, AppError> {
    let Some(raw) = backend.read(account)? else {
        return Ok(None);
    };
    let credential: StoredCredential = serde_json::from_slice(&raw).map_err(|_| {
        AppError::new(
            "CREDENTIAL_INVALID",
            "系统钥匙串中的凭据格式无效，请清除后重新配置。",
        )
    })?;
    if credential.version != CREDENTIAL_PAYLOAD_VERSION || credential.secret.trim().is_empty() {
        return Err(AppError::new(
            "CREDENTIAL_INVALID",
            "系统钥匙串中的凭据版本无效，请清除后重新配置。",
        ));
    }
    Ok(Some(credential))
}

pub(crate) fn replace_credential_verified_with_backend<B: CredentialBackend>(
    backend: &mut B,
    account: CredentialAccount,
    secret: &str,
    binding: &str,
) -> Result<CredentialRollback, AppError> {
    let previous_value = backend.read(account)?;
    let payload = StoredCredential {
        version: CREDENTIAL_PAYLOAD_VERSION,
        secret: secret.to_string(),
        binding: binding.to_string(),
    };
    let serialized = serde_json::to_vec(&payload)
        .map_err(|_| AppError::new("CREDENTIAL_SERIALIZE_FAILED", "无法准备系统钥匙串凭据。"))?;

    if let Err(error) = backend.write(account, &serialized) {
        restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
        return Err(error);
    }
    let verification = match backend.read(account) {
        Ok(verification) => verification,
        Err(error) => {
            restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
            return Err(error);
        }
    };
    if verification.as_deref() != Some(serialized.as_slice()) {
        restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
        return Err(AppError::new(
            "CREDENTIAL_VERIFY_FAILED",
            "系统钥匙串凭据回读验证失败，配置未更新。",
        ));
    }

    Ok(CredentialRollback {
        account,
        previous_value,
    })
}

pub(crate) fn rollback_credential_with_backend<B: CredentialBackend>(
    backend: &mut B,
    rollback: CredentialRollback,
) -> Result<(), AppError> {
    restore_raw_credential_with_backend(
        backend,
        rollback.account,
        rollback.previous_value.as_deref(),
    )
}

pub(crate) fn clear_credential_verified_with_backend<B: CredentialBackend>(
    backend: &mut B,
    account: CredentialAccount,
) -> Result<CredentialRollback, AppError> {
    let previous_value = backend.read(account)?;
    if let Err(error) = backend.delete(account) {
        restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
        return Err(error);
    }
    match backend.read(account) {
        Ok(None) => Ok(CredentialRollback {
            account,
            previous_value,
        }),
        Ok(Some(_)) => {
            restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
            Err(AppError::new(
                "CREDENTIAL_VERIFY_FAILED",
                "系统钥匙串凭据清除验证失败，配置未更新。",
            ))
        }
        Err(error) => {
            restore_raw_credential_with_backend(backend, account, previous_value.as_deref())?;
            Err(error)
        }
    }
}

#[cfg(target_os = "macos")]
fn read_raw_credential(account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
    use security_framework::passwords::get_generic_password;

    match get_generic_password(KEYCHAIN_SERVICE, account.as_str()) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => Ok(None),
        Err(_) => Err(AppError::new(
            "CREDENTIAL_READ_FAILED",
            "无法读取系统钥匙串，请检查钥匙串访问权限。",
        )),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_raw_credential(_account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
    Err(AppError::new(
        "CREDENTIAL_PLATFORM_UNSUPPORTED",
        "当前平台不支持系统钥匙串凭据。",
    ))
}

#[cfg(target_os = "macos")]
fn write_raw_credential(account: CredentialAccount, value: &[u8]) -> Result<(), AppError> {
    use security_framework::passwords::set_generic_password;

    set_generic_password(KEYCHAIN_SERVICE, account.as_str(), value).map_err(|_| {
        AppError::new(
            "CREDENTIAL_WRITE_FAILED",
            "无法写入系统钥匙串，配置未更新。",
        )
    })
}

#[cfg(not(target_os = "macos"))]
fn write_raw_credential(_account: CredentialAccount, _value: &[u8]) -> Result<(), AppError> {
    Err(AppError::new(
        "CREDENTIAL_PLATFORM_UNSUPPORTED",
        "当前平台不支持系统钥匙串凭据。",
    ))
}

fn restore_raw_credential_with_backend<B: CredentialBackend>(
    backend: &mut B,
    account: CredentialAccount,
    previous_value: Option<&[u8]>,
) -> Result<(), AppError> {
    let restore_result = match previous_value {
        Some(value) => backend.write(account, value),
        None => backend.delete(account),
    };
    if restore_result.is_err() {
        return Err(credential_rollback_failed_error());
    }

    let restored_value = backend
        .read(account)
        .map_err(|_| credential_rollback_failed_error())?;
    if restored_value.as_deref() != previous_value {
        return Err(credential_rollback_failed_error());
    }
    Ok(())
}

fn credential_rollback_failed_error() -> AppError {
    AppError::new(
        "CREDENTIAL_ROLLBACK_FAILED",
        "系统钥匙串凭据回滚验证失败，云服务已阻断；请重新配置凭据。",
    )
}

#[cfg(target_os = "macos")]
fn delete_raw_credential(account: CredentialAccount) -> Result<(), AppError> {
    use security_framework::passwords::delete_generic_password;

    match delete_generic_password(KEYCHAIN_SERVICE, account.as_str()) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == KEYCHAIN_ITEM_NOT_FOUND => Ok(()),
        Err(_) => Err(AppError::new(
            "CREDENTIAL_DELETE_FAILED",
            "无法从系统钥匙串清除凭据。",
        )),
    }
}

#[cfg(not(target_os = "macos"))]
fn delete_raw_credential(_account: CredentialAccount) -> Result<(), AppError> {
    Err(AppError::new(
        "CREDENTIAL_PLATFORM_UNSUPPORTED",
        "当前平台不支持系统钥匙串凭据。",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeCredentialBackend {
        values: HashMap<CredentialAccount, Vec<u8>>,
        read_count: usize,
        fail_read_on: Option<usize>,
        corrupt_read_on: Option<usize>,
        ignore_write: bool,
        ignore_delete: bool,
    }

    impl CredentialBackend for FakeCredentialBackend {
        fn read(&mut self, account: CredentialAccount) -> Result<Option<Vec<u8>>, AppError> {
            self.read_count += 1;
            if self.fail_read_on == Some(self.read_count) {
                return Err(AppError::new(
                    "CREDENTIAL_READ_FAILED",
                    "Injected credential read failure.",
                ));
            }
            if self.corrupt_read_on == Some(self.read_count) {
                return Ok(Some(b"corrupted-verification-value".to_vec()));
            }
            Ok(self.values.get(&account).cloned())
        }

        fn write(&mut self, account: CredentialAccount, value: &[u8]) -> Result<(), AppError> {
            if !self.ignore_write {
                self.values.insert(account, value.to_vec());
            }
            Ok(())
        }

        fn delete(&mut self, account: CredentialAccount) -> Result<(), AppError> {
            if !self.ignore_delete {
                self.values.remove(&account);
            }
            Ok(())
        }
    }

    fn serialized_credential(secret: &str, binding: &str) -> Vec<u8> {
        serde_json::to_vec(&StoredCredential {
            version: CREDENTIAL_PAYLOAD_VERSION,
            secret: secret.to_string(),
            binding: binding.to_string(),
        })
        .expect("serialize test credential")
    }

    #[test]
    fn credential_payload_contains_only_version_secret_and_binding() {
        let payload = StoredCredential {
            version: CREDENTIAL_PAYLOAD_VERSION,
            secret: "test-secret".to_string(),
            binding: "https://api.example.com".to_string(),
        };
        let value = serde_json::to_value(payload).expect("serialize credential payload");

        assert_eq!(value["version"], CREDENTIAL_PAYLOAD_VERSION);
        assert_eq!(value["secret"], "test-secret");
        assert_eq!(value["binding"], "https://api.example.com");
        assert_eq!(value.as_object().map(|object| object.len()), Some(3));
    }

    #[test]
    fn failed_write_verification_restores_previous_credential() {
        let previous_value = serialized_credential("previous-secret", "https://old.example.com");
        let mut backend = FakeCredentialBackend {
            corrupt_read_on: Some(2),
            ..Default::default()
        };
        backend
            .values
            .insert(CredentialAccount::DeepSeek, previous_value.clone());

        let error = match replace_credential_verified_with_backend(
            &mut backend,
            CredentialAccount::DeepSeek,
            "new-secret-must-not-leak",
            "https://new.example.com",
        ) {
            Err(error) => error,
            Ok(_) => panic!("corrupted verification must fail"),
        };

        assert_eq!(error.code, "CREDENTIAL_VERIFY_FAILED");
        assert!(!error.message.contains("new-secret-must-not-leak"));
        assert_eq!(
            backend.values.get(&CredentialAccount::DeepSeek),
            Some(&previous_value)
        );
    }

    #[test]
    fn failed_clear_verification_restores_previous_credential() {
        let previous_value = serialized_credential("previous-secret", "eastasia");
        let mut backend = FakeCredentialBackend {
            fail_read_on: Some(2),
            ..Default::default()
        };
        backend
            .values
            .insert(CredentialAccount::Azure, previous_value.clone());

        let error =
            match clear_credential_verified_with_backend(&mut backend, CredentialAccount::Azure) {
                Err(error) => error,
                Ok(_) => panic!("failed clear readback must fail"),
            };

        assert_eq!(error.code, "CREDENTIAL_READ_FAILED");
        assert_eq!(
            backend.values.get(&CredentialAccount::Azure),
            Some(&previous_value)
        );
    }

    #[test]
    fn credential_rollback_restores_snapshot_after_verified_write() {
        let previous_value = serialized_credential("previous-secret", "https://old.example.com");
        let mut backend = FakeCredentialBackend::default();
        backend
            .values
            .insert(CredentialAccount::Zhipu, previous_value.clone());

        let rollback = replace_credential_verified_with_backend(
            &mut backend,
            CredentialAccount::Zhipu,
            "replacement-secret",
            "https://new.example.com",
        )
        .expect("verified replacement");
        rollback_credential_with_backend(&mut backend, rollback).expect("rollback credential");

        assert_eq!(
            backend.values.get(&CredentialAccount::Zhipu),
            Some(&previous_value)
        );
    }

    #[test]
    fn rollback_rejects_write_that_reports_success_without_restoring_bytes() {
        let previous_value = serialized_credential("previous-secret", "https://old.example.com");
        let current_value = serialized_credential("current-secret", "https://new.example.com");
        let mut backend = FakeCredentialBackend {
            ignore_write: true,
            ..Default::default()
        };
        backend
            .values
            .insert(CredentialAccount::DeepSeek, current_value.clone());
        let rollback = CredentialRollback {
            account: CredentialAccount::DeepSeek,
            previous_value: Some(previous_value),
        };

        let error = rollback_credential_with_backend(&mut backend, rollback)
            .expect_err("ignored rollback write must fail verification");

        assert_eq!(error.code, "CREDENTIAL_ROLLBACK_FAILED");
        assert_eq!(
            backend.values.get(&CredentialAccount::DeepSeek),
            Some(&current_value)
        );
    }

    #[test]
    fn rollback_rejects_delete_that_reports_success_without_removing_bytes() {
        let current_value = serialized_credential("current-secret", "eastasia");
        let mut backend = FakeCredentialBackend {
            ignore_delete: true,
            ..Default::default()
        };
        backend
            .values
            .insert(CredentialAccount::Azure, current_value.clone());
        let rollback = CredentialRollback {
            account: CredentialAccount::Azure,
            previous_value: None,
        };

        let error = rollback_credential_with_backend(&mut backend, rollback)
            .expect_err("ignored rollback delete must fail verification");

        assert_eq!(error.code, "CREDENTIAL_ROLLBACK_FAILED");
        assert_eq!(
            backend.values.get(&CredentialAccount::Azure),
            Some(&current_value)
        );
    }

    #[test]
    fn fixed_keychain_accounts_are_stable() {
        assert_eq!(CredentialAccount::DeepSeek.as_str(), "deepseek");
        assert_eq!(CredentialAccount::Zhipu.as_str(), "zhipu");
        assert_eq!(CredentialAccount::Azure.as_str(), "azure");
    }
}
