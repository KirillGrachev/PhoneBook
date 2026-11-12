//! Установка соединения и аутентификация (StartTLS/LDAPS, GSSAPI/SSPI).

use ldap3::{LdapConnAsync, LdapConnSettings};
use tokio::task::JoinHandle;
use tracing::{debug, info};

use crate::error::AppError;

use super::errors::{auth_error_text, classify_error};
use super::model::DirectoryCredentials;
use super::parse::non_empty;

/// LDAP-соединение вместе с задачей драйвера.
///
/// `ldap3::drive!` запускает драйвер отдельной задачей и теряет её handle.
/// После `unbind` такая задача может ещё жить до закрытия сокета сервером и
/// позже писать `socket shutdown error` в лог. Держим handle сами и
/// останавливаем драйвер при уничтожении сессии.
pub(super) struct LdapSession {
    pub(super) ldap: ldap3::Ldap,
    /// URL of the controller that accepted the connection.
    pub(super) url: String,
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
    let urls = url_candidates(credentials.ldap_url);
    if urls.is_empty() {
        return Err(AppError::Validation(
            "Адрес сервера должен начинаться с ldap:// или ldaps://".into(),
        ));
    }
    validate_transport_security(credentials)?;

    let mut last_error = None;
    for url in urls {
        let mut settings = LdapConnSettings::new().set_conn_timeout(credentials.connect_timeout());
        if credentials.use_start_tls && url.starts_with("ldap://") {
            settings = settings.set_starttls(true);
        }
        if credentials.allow_invalid_tls {
            settings = settings.set_no_tls_verify(true);
        }

        match LdapConnAsync::with_settings(settings, url).await {
            Ok((conn, ldap)) => {
                // Драйвер соединения должен жить всё время работы с LDAP. В
                // отличие от `ldap3::drive!`, сохраняем handle, чтобы завершить
                // задачу вместе с сессией, а не оставлять сокет до таймаута
                // контроллера домена.
                let driver = tokio::spawn(async move {
                    if let Err(error) = conn.drive().await {
                        // Штатное закрытие соединения после unbind тоже приходит
                        // сюда; это не ошибка синхронизации, поэтому debug.
                        debug!(error = %error, "LDAP: драйвер соединения завершён");
                    }
                });
                if credentials.use_start_tls {
                    info!("StartTLS запрошен для {url}");
                }
                return Ok(LdapSession {
                    ldap,
                    url: url.to_string(),
                    driver,
                });
            }
            Err(error) => {
                debug!(url, error = %error, "LDAP: контроллер недоступен, пробую следующий");
                last_error = Some(classify_error(url, &error));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        AppError::LdapUnreachable("ни один контроллер домена не ответил".into())
    }))
}

/// Accepts one URL or a comma/semicolon separated failover list.
fn url_candidates(raw: &str) -> Vec<&str> {
    raw.split([',', ';'])
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .filter(|url| url.starts_with("ldap://") || url.starts_with("ldaps://"))
        .collect()
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
    let all_secure = url_candidates(credentials.ldap_url)
        .iter()
        .all(|url| url.starts_with("ldaps://") || credentials.use_start_tls);
    if has_password && !credentials.use_integrated_auth && !all_secure {
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
    url: &str,
) -> Result<u64, AppError> {
    let started = std::time::Instant::now();

    if credentials.use_integrated_auth {
        #[cfg(windows)]
        {
            // Kerberos/NTLM-билет текущего вошедшего в систему пользователя (SSPI).
            let fqdn = extract_host_fqdn(url);
            debug!(fqdn = %fqdn, "LDAP: интегрированная аутентификация (GSSAPI/SSPI)");
            let result = ldap
                .with_timeout(credentials.operation_timeout())
                .sasl_gssapi_bind(&fqdn)
                .await
                .map_err(|e| classify_error(url, &e))?;
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
        .with_timeout(credentials.operation_timeout())
        .simple_bind(bind_dn, password)
        .await
        .map_err(|e| classify_error(url, &e))?;
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
            connect_timeout_secs: 15,
            operation_timeout_secs: 30,
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
    fn splits_controller_failover_list() {
        assert_eq!(
            url_candidates("ldap://dc1.example.ru, ldaps://dc2.example.ru:636;evil"),
            vec!["ldap://dc1.example.ru", "ldaps://dc2.example.ru:636"]
        );
        assert!(url_candidates(" https://example.ru ").is_empty());
    }

    #[test]
    fn rejects_mixed_plain_controller_with_password() {
        let result = validate_transport_security(&credentials(
            "ldaps://dc1.example.ru, ldap://dc2.example.ru",
            Some("secret"),
            false,
        ));
        assert!(matches!(result, Err(AppError::LdapTls(_))));
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
