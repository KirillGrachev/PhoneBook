//! Установка соединения и аутентификация (StartTLS/LDAPS, GSSAPI/SSPI).

use ldap3::{LdapConnAsync, LdapConnSettings};
use tokio::task::JoinHandle;
use tracing::{debug, info};

use crate::error::AppError;

use super::errors::{auth_error_text, classify_error};
use super::model::{DirectoryCredentials, CONNECT_TIMEOUT, OPERATION_TIMEOUT};
use super::parse::non_empty;

/// LDAP-соединение вместе с задачей драйвера.
///
/// `ldap3::drive!` запускает драйвер отдельной задачей и теряет её handle.
/// После `unbind` такая задача может ещё жить до закрытия сокета сервером и
/// позже писать `socket shutdown error` в лог. Держим handle сами и
/// останавливаем драйвер при уничтожении сессии.
pub(super) struct LdapSession {
    pub(super) ldap: ldap3::Ldap,
    driver: JoinHandle<()>,
}

impl Drop for LdapSession {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

pub(super) async fn connect(
    credentials: &DirectoryCredentials<'_>,
) -> Result<LdapSession, AppError> {
    let url = credentials.ldap_url.trim();
    if !(url.starts_with("ldap://") || url.starts_with("ldaps://")) {
        return Err(AppError::Validation(
            "Адрес сервера должен начинаться с ldap:// или ldaps://".into(),
        ));
    }
    validate_transport_security(credentials)?;

    let mut settings = LdapConnSettings::new().set_conn_timeout(CONNECT_TIMEOUT);
    if credentials.use_start_tls && url.starts_with("ldap://") {
        settings = settings.set_starttls(true);
    }
    if credentials.allow_invalid_tls {
        settings = settings.set_no_tls_verify(true);
    }

    let (conn, ldap) = LdapConnAsync::with_settings(settings, url)
        .await
        .map_err(|e| classify_error(url, &e))?;

    // Драйвер соединения должен жить всё время работы с LDAP. В отличие от
    // `ldap3::drive!`, сохраняем handle, чтобы завершить задачу вместе с
    // сессией, а не оставлять сокет до таймаута контроллера домена.
    let driver = tokio::spawn(async move {
        if let Err(error) = conn.drive().await {
            // Штатное закрытие соединения после unbind тоже приходит сюда;
            // это не ошибка синхронизации, поэтому только debug.
            debug!(error = %error, "LDAP: драйвер соединения завершён");
        }
    });

    if credentials.use_start_tls {
        info!("StartTLS запрошен для {url}");
    }
    Ok(LdapSession { ldap, driver })
}

/// Извлекает FQDN хоста из LDAP-URL (нужен для SPN `ldap/<fqdn>` в GSSAPI).
#[cfg(any(windows, test))]
fn extract_host_fqdn(url: &str) -> String {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host_port = without_scheme.split('/').next().unwrap_or(without_scheme);
    host_port.split(':').next().unwrap_or(host_port).to_string()
}

/// Аутентификация: SASL GSSAPI под текущей сессией Windows (если включена),
/// иначе простой bind учётной записью, иначе анонимно. Возвращает длительность, мс.
/// Пароль LDAP — секрет, который нельзя отправлять по `ldap://` без
/// StartTLS. Анонимный bind и GSSAPI не используют пароль, поэтому их
/// ограничение не касается; для пароля обязателен `ldaps://` или StartTLS.
fn validate_transport_security(credentials: &DirectoryCredentials<'_>) -> Result<(), AppError> {
    let has_password = credentials
        .password
        .is_some_and(|password| !password.trim().is_empty());
    let tls = credentials.ldap_url.trim().starts_with("ldaps://") || credentials.use_start_tls;
    if has_password && !credentials.use_integrated_auth && !tls {
        return Err(AppError::LdapTls(
            "Пароль LDAP нельзя отправлять по ldap:// без StartTLS. \
             Включите StartTLS или используйте ldaps://."
                .into(),
        ));
    }
    Ok(())
}

pub(super) async fn bind(
    ldap: &mut ldap3::Ldap,
    credentials: &DirectoryCredentials<'_>,
) -> Result<u64, AppError> {
    let started = std::time::Instant::now();

    if credentials.use_integrated_auth {
        #[cfg(windows)]
        {
            // Kerberos/NTLM-билет текущего вошедшего в систему пользователя (SSPI).
            let fqdn = extract_host_fqdn(credentials.ldap_url);
            debug!(fqdn = %fqdn, "LDAP: интегрированная аутентификация (GSSAPI/SSPI)");
            let result = ldap
                .with_timeout(OPERATION_TIMEOUT)
                .sasl_gssapi_bind(&fqdn)
                .await
                .map_err(|e| classify_error(credentials.ldap_url, &e))?;
            if result.rc != 0 {
                return Err(AppError::LdapAuth(format!(
                    "домен отклонил интегрированную аутентификацию текущего пользователя Windows: код {} ({})",
                    result.rc,
                    result.text.trim()
                )));
            }
            return Ok(started.elapsed().as_millis() as u64);
        }
        #[cfg(not(windows))]
        {
            let _ = ldap;
            return Err(AppError::Validation(
                "Аутентификация под текущей сессией Windows поддерживается только в Windows-сборке. Отключите её и укажите учётную запись с паролем.".into(),
            ));
        }
    }

    let (Some(bind_dn), Some(password)) = (
        credentials.bind_dn.and_then(non_empty),
        credentials.password.and_then(non_empty),
    ) else {
        debug!("LDAP: анонимный bind");
        return Ok(0);
    };

    let result = ldap
        .with_timeout(OPERATION_TIMEOUT)
        .simple_bind(bind_dn, password)
        .await
        .map_err(|e| classify_error(credentials.ldap_url, &e))?;
    if result.rc != 0 {
        return Err(AppError::LdapAuth(auth_error_text(result.rc, &result.text)));
    }
    let elapsed = started.elapsed().as_millis() as u64;
    debug!(elapsed_ms = elapsed, "LDAP: bind выполнен");
    Ok(elapsed)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_host_fqdn_from_ldap_urls() {
        assert_eq!(extract_host_fqdn("ldap://dc1.kmaruda.ru"), "dc1.kmaruda.ru");
        assert_eq!(
            extract_host_fqdn("ldaps://dc1.kmaruda.ru:636"),
            "dc1.kmaruda.ru"
        );
        assert_eq!(extract_host_fqdn("ldap://10.0.0.5:389/"), "10.0.0.5");
    }

    fn credentials<'a>(
        url: &'a str,
        password: Option<&'a str>,
        start_tls: bool,
    ) -> DirectoryCredentials<'a> {
        DirectoryCredentials {
            ldap_url: url,
            base_dn: "DC=example,DC=ru",
            bind_dn: Some("CN=svc,DC=example,DC=ru"),
            password,
            use_start_tls: start_tls,
            allow_invalid_tls: false,
            use_integrated_auth: false,
        }
    }

    #[test]
    fn rejects_password_over_plain_ldap() {
        let result = validate_transport_security(&credentials(
            "ldap://dc1.example.ru",
            Some("secret"),
            false,
        ));
        assert!(matches!(result, Err(AppError::LdapTls(_))));
    }

    #[test]
    fn allows_password_over_ldaps_or_starttls() {
        assert!(validate_transport_security(&credentials(
            "ldaps://dc1.example.ru:636",
            Some("secret"),
            false,
        ))
        .is_ok());
        assert!(validate_transport_security(&credentials(
            "ldap://dc1.example.ru",
            Some("secret"),
            true,
        ))
        .is_ok());
    }

    #[test]
    fn allows_anonymous_or_integrated_auth_without_tls() {
        assert!(
            validate_transport_security(&credentials("ldap://dc1.example.ru", None, false,))
                .is_ok()
        );
        let mut integrated = credentials("ldap://dc1.example.ru", Some("ignored"), false);
        integrated.use_integrated_auth = true;
        assert!(validate_transport_security(&integrated).is_ok());
    }
}
