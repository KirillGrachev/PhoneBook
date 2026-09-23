//! Нативный LDAP-клиент на `ldap3` (tokio): запросы к Active Directory
//! выполняются напрямую, без внешних скриптов и системных модулей.
//!
//! * постраничный поиск (адаптер `PagedResults`) — каталоги крупнее
//!   1000 записей не обрезаются;
//! * StartTLS и LDAPS, опционально без проверки сертификата (внутренние CA);
//! * таймауты: `conn_timeout` на подключение и `with_timeout` на операции;
//! * декодирование бинарных атрибутов AD: `objectGUID`, `uSNChanged`
//!   (с учётом того, что ldap3 уносит значения, случайно оказавшиеся
//!   валидным UTF-8, в строковые атрибуты);
//! * диагностика кодов отказа аутентификации AD (`data 52e` и т.п.).
mod connect;
mod errors;
mod model;
mod parse;

pub use model::{ConnectionTest, DirectoryCredentials, RawUser, USER_FILTER};

use ldap3::adapters::{Adapter, EntriesOnly, PagedResults};
use ldap3::{Scope, SearchEntry, SearchResult};
use tracing::{debug, info};

use crate::error::AppError;

use connect::{bind, connect};
use errors::{classify_error, classify_search_result};
use model::{OPERATION_TIMEOUT, PAGE_SIZE, USER_ATTRIBUTES};
use parse::{attr_ci, map_entry, non_empty};

/// Полный цикл выборки пользователей каталога с постраничным поиском.
///
/// `progress` вызывается после получения каждой страницы — используется
/// для live-событий синхронизации.
pub async fn fetch_users<F>(
    credentials: DirectoryCredentials<'_>,
    mut progress: F,
) -> Result<Vec<RawUser>, AppError>
where
    F: FnMut(usize),
{
    let base_dn = credentials.base_dn.trim();
    if base_dn.is_empty() {
        return Err(AppError::Validation(
            "Укажите Base DN (например, DC=kmaruda,DC=ru) в настройках Active Directory".into(),
        ));
    }

    let mut ldap = connect(&credentials).await?;
    bind(&mut ldap, &credentials).await?;

    let attributes: Vec<&str> = USER_ATTRIBUTES.to_vec();

    let adapters: Vec<Box<dyn Adapter<_, _>>> = vec![
        Box::new(EntriesOnly::new()),
        Box::new(PagedResults::new(PAGE_SIZE)),
    ];

    // with_timeout переходит во внутренний клон Ldap потока поиска:
    // каждая страница ограничена OPERATION_TIMEOUT.
    let mut stream = ldap
        .with_timeout(OPERATION_TIMEOUT)
        .streaming_search_with(adapters, base_dn, Scope::Subtree, USER_FILTER, attributes)
        .await
        .map_err(|e| classify_error(credentials.ldap_url, &e))?;

    let mut users = Vec::new();
    loop {
        let entry = stream
            .next()
            .await
            .map_err(|e| classify_error(credentials.ldap_url, &e))?;
        let Some(entry) = entry else { break };
        users.push(map_entry(entry));
        if users.len() % PAGE_SIZE as usize == 0 {
            debug!(fetched = users.len(), "LDAP: страница получена");
            progress(users.len());
        }
    }

    let result = stream.finish().await;
    // rc == 4 (sizeLimitExceeded) при постраничном поиске не ожидается,
    // но и не смертелен: данные мы уже получили.
    if result.rc != 0 && result.rc != 4 {
        return Err(classify_search_result(credentials.ldap_url, &result));
    }

    let _ = ldap.unbind().await;
    info!(count = users.len(), "LDAP: выборка пользователей завершена");
    Ok(users)
}

/// Диагностика подключения: bind, rootDSE, пробная выборка сотрудников.
pub async fn test_connection(
    credentials: DirectoryCredentials<'_>,
) -> Result<ConnectionTest, AppError> {
    let mut ldap = connect(&credentials).await?;
    let bind_ms = bind(&mut ldap, &credentials).await?;

    // rootDSE: имя сервера и корень домена (подсказка для Base DN).
    let SearchResult(root_entries, root_result) = ldap
        .with_timeout(OPERATION_TIMEOUT)
        .search(
            "",
            Scope::Base,
            "(objectClass=*)",
            vec!["dnsHostName", "defaultNamingContext"],
        )
        .await
        .map_err(|e| classify_error(credentials.ldap_url, &e))?;

    let mut server_dns_name = None;
    let mut default_naming_context = None;
    if root_result.rc == 0 {
        for raw in root_entries {
            let entry = SearchEntry::construct(raw);
            server_dns_name = attr_ci(&entry, "dnshostname");
            default_naming_context = attr_ci(&entry, "defaultnamingcontext");
        }
    } else {
        debug!(rc = root_result.rc, "rootDSE недоступен (не критично)");
    }

    // Пробная выборка: проверяем, что Base DN валиден и поиск отдаёт людей.
    let base = non_empty(credentials.base_dn.trim())
        .or(default_naming_context.as_deref())
        .unwrap_or_default();
    let mut sample_names = Vec::new();
    let mut sample_is_truncated = false;
    if !base.is_empty() {
        let SearchResult(entries, result) = ldap
            .with_timeout(OPERATION_TIMEOUT)
            .search(base, Scope::Subtree, USER_FILTER, vec!["displayName"])
            .await
            .map_err(|e| classify_error(credentials.ldap_url, &e))?;

        // rc 4 = sizeLimitExceeded: сервер отдал первую страницу — для теста достаточно.
        if result.rc == 0 || result.rc == 4 {
            for raw in entries {
                let entry = SearchEntry::construct(raw);
                if let Some(name) = attr_ci(&entry, "displayname") {
                    sample_names.push(name);
                }
            }
            sample_is_truncated = sample_names.len() > 5;
            sample_names.truncate(5);
        } else {
            return Err(classify_search_result(credentials.ldap_url, &result));
        }
    }

    let _ = ldap.unbind().await;
    Ok(ConnectionTest {
        bind_ms,
        server_dns_name,
        default_naming_context,
        sample_names,
        sample_is_truncated,
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_urls() {
        let credentials = DirectoryCredentials {
            ldap_url: "http://dc1.kmaruda.ru",
            base_dn: "DC=x",
            bind_dn: None,
            password: None,
            use_start_tls: false,
            allow_invalid_tls: false,
            use_integrated_auth: true,
        };
        let result = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime")
            .block_on(fetch_users(credentials, |_| {}));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }
}
