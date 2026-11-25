//! Native LDAP client on `ldap3` (tokio): Active Directory queries
//! executed directly, without external scripts or system modules.
//!
//! * paginated search (`PagedResults` adapter) - catalogs larger than
//! 1000 records are not truncated;
//! * StartTLS and LDAPS, optionally without certificate verification (internal CAs);
//! * timeouts: `conn_timeout` for connection and `with_timeout` for operations;
//! * decoding binary AD attributes: `objectGUID`, `uSNChanged`
//! (considering that ldap3 moves values that accidentally ended up as
//! valid UTF-8 in string attributes);
//! * diagnostics of AD authentication failure codes (`data 52e`, etc.).
mod connect;
mod errors;
mod model;
mod parse;

pub use model::{ConnectionTest, DirectoryCredentials, RawUser, USER_FILTER};

/// Filter for incremental selection: all live users whose
/// `uSNChanged` greater than or equal to `since` (inclusive). `None` - full selection.
pub fn user_filter_since(since: Option<i64>) -> String {
    match since {
        Some(usn) => format!("(&{USER_FILTER}(uSNChanged>={usn}))"),
        None => USER_FILTER.to_string(),
    }
}

use std::time::Instant;

use ldap3::adapters::{Adapter, EntriesOnly, PagedResults};
use ldap3::{Scope, SearchEntry, SearchResult};
use tracing::{debug, info};

use crate::error::AppError;

use connect::{bind, connect};
use errors::{classify_error, classify_search_result};
use model::{PAGE_SIZE, USER_ATTRIBUTES};
use parse::{attr_ci, map_entry, non_empty};

/// Full cycle of selecting catalog users with paginated search.
///
/// `progress` is called after each page is received - used
/// for live sync events.
pub async fn fetch_users<F>(
    credentials: DirectoryCredentials<'_>,
    filter: &str,
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

    let mut session = connect(&credentials).await?;
    bind(&mut session.ldap, &credentials, &session.url).await?;

    let attributes: Vec<&str> = USER_ATTRIBUTES.to_vec();

    let adapters: Vec<Box<dyn Adapter<_, _>>> = vec![
        Box::new(EntriesOnly::new()),
        Box::new(PagedResults::new(PAGE_SIZE)),
    ];

    // with_timeout moves into the internal Ldap clone of the search thread:
    // each page is limited by a configurable operation timeout.
    let mut stream = session
        .ldap
        .with_timeout(credentials.operation_timeout())
        .streaming_search_with(adapters, base_dn, Scope::Subtree, filter, attributes)
        .await
        .map_err(|e| classify_error(&session.url, &e))?;

    let fetch_started = Instant::now();
    let mut pages = 0usize;
    let mut users = Vec::new();
    loop {
        let entry = stream
            .next()
            .await
            .map_err(|e| classify_error(&session.url, &e))?;
        let Some(entry) = entry else { break };
        users.push(map_entry(entry));
        if users.len() % PAGE_SIZE as usize == 0 {
            pages += 1;
            debug!(
                fetched = users.len(),
                pages,
                elapsed_ms = fetch_started.elapsed().as_millis() as u64,
                "LDAP: страница получена"
            );
            progress(users.len());
        }
    }

    let result = stream.finish().await;
    // rc == 4 (sizeLimitExceeded) is not expected with paginated search,
    // but it is not fatal either: we already received the data.
    if result.rc != 0 && result.rc != 4 {
        return Err(classify_search_result(&session.url, &result));
    }

    let _ = session.ldap.unbind().await;
    // session.drop stops the driver and closes the socket deterministically.
    info!(
        count = users.len(),
        pages,
        elapsed_ms = fetch_started.elapsed().as_millis() as u64,
        "LDAP: выборка пользователей завершена"
    );
    Ok(users)
}

/// Connection diagnostics: bind, rootDSE, sample employee selection.
pub async fn test_connection(
    credentials: DirectoryCredentials<'_>,
) -> Result<ConnectionTest, AppError> {
    let mut session = connect(&credentials).await?;
    let bind_ms = bind(&mut session.ldap, &credentials, &session.url).await?;

    // rootDSE: the server name and the domain root (a hint for Base DN).
    let SearchResult(root_entries, root_result) = session
        .ldap
        .with_timeout(credentials.operation_timeout())
        .search(
            "",
            Scope::Base,
            "(objectClass=*)",
            vec!["dnsHostName", "defaultNamingContext"],
        )
        .await
        .map_err(|e| classify_error(&session.url, &e))?;

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

    // A trial sample: we check that Base DN is valid and the search returns people.
    let base = non_empty(credentials.base_dn.trim())
        .or(default_naming_context.as_deref())
        .unwrap_or_default();
    let mut sample_names = Vec::new();
    let mut sample_is_truncated = false;
    if !base.is_empty() {
        let SearchResult(entries, result) = session
            .ldap
            .with_timeout(credentials.operation_timeout())
            .search(base, Scope::Subtree, USER_FILTER, vec!["displayName"])
            .await
            .map_err(|e| classify_error(&session.url, &e))?;

        // rc 4 = sizeLimitExceeded: the server returned the first page — enough for the test.
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
            return Err(classify_search_result(&session.url, &result));
        }
    }

    let _ = session.ldap.unbind().await;
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
    fn builds_full_and_incremental_filters() {
        assert_eq!(user_filter_since(None), USER_FILTER);
        let incremental = user_filter_since(Some(42));
        assert!(incremental.contains("uSNChanged>=42"));
        assert!(incremental.starts_with("(&"));
        assert!(incremental.ends_with(')'));
    }

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
            connect_timeout_secs: 15,
            operation_timeout_secs: 30,
        };
        let result = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime")
            .block_on(fetch_users(credentials, USER_FILTER, |_| {}));
        assert!(matches!(result, Err(AppError::Validation(_))));
    }
}
