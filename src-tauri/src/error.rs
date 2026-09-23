//! Единая модель ошибок приложения.
//!
//! Ошибки пересекают IPC-границу в виде структуры `{ code, message, details? }`:
//! * `code` — стабильный машиночитаемый идентификатор. Фронтенд использует его
//!   как ключ локализации (`errors.<CODE>`) и не парсит человекочитаемый текст.
//! * `message` — текст для пользователя (по-русски, продукт RU-first).
//! * `details` — технические подробности для логов и диагностических тостов.

use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("{0}")]
    Config(String),

    #[error("{0}")]
    Validation(String),

    #[error("Сервер каталога недоступен: {0}")]
    LdapUnreachable(String),

    #[error("Превышено время ожидания ответа сервера каталога. Проверьте адрес сервера и доступность сети (VPN).")]
    LdapTimeout,

    #[error("Отказано в авторизации в каталоге: {0}")]
    LdapAuth(String),

    #[error("Ошибка защищённого соединения (TLS): {0}")]
    LdapTls(String),

    #[error("Ошибка протокола LDAP: {0}")]
    LdapProtocol(String),

    #[error("Ошибка локальной базы данных: {0}")]
    Db(String),

    #[error("{0}")]
    NotFound(String),

    #[error("Внутренняя ошибка: {0}")]
    Internal(String),
}

impl AppError {
    /// Стабильный код ошибки для фронтенда (i18n-ключ `errors.<CODE>`).
    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(_) => "CONFIG_ERROR",
            Self::Validation(_) => "VALIDATION",
            Self::LdapUnreachable(_) => "LDAP_UNREACHABLE",
            Self::LdapTimeout => "LDAP_TIMEOUT",
            Self::LdapAuth(_) => "LDAP_AUTH",
            Self::LdapTls(_) => "LDAP_TLS",
            Self::LdapProtocol(_) => "LDAP_PROTOCOL",
            Self::Db(_) => "DB_ERROR",
            Self::NotFound(_) => "NOT_FOUND",
            Self::Internal(_) => "INTERNAL",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Payload<'a> {
            code: &'static str,
            message: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            details: Option<&'a str>,
        }

        Payload {
            code: self.code(),
            message: self.to_string(),
            details: None,
        }
        .serialize(serializer)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Db(value.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_stable_contract() {
        let err = AppError::LdapAuth("неверный логин или пароль".into());
        let json = serde_json::to_value(&err).expect("serialize");
        assert_eq!(json["code"], "LDAP_AUTH");
        assert!(json["message"].as_str().unwrap().contains("неверный логин"));
        assert!(json.get("details").is_none());
    }

    #[test]
    fn every_variant_has_unique_code() {
        let variants = [
            AppError::Config("x".into()),
            AppError::Validation("x".into()),
            AppError::LdapUnreachable("x".into()),
            AppError::LdapTimeout,
            AppError::LdapAuth("x".into()),
            AppError::LdapTls("x".into()),
            AppError::LdapProtocol("x".into()),
            AppError::Db("x".into()),
            AppError::NotFound("x".into()),
            AppError::Internal("x".into()),
        ];
        let codes: Vec<&str> = variants.iter().map(AppError::code).collect();
        let mut unique = codes.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(codes.len(), unique.len());
    }
}
