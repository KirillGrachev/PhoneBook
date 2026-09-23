//! Типы данных кэша: DTO сотрудника, запись синхронизации, параметры поиска.

use serde::{Deserialize, Serialize};

/// Сотрудник — DTO, пересекающее IPC-границу (serde → camelCase).
///
/// Намеренно **не содержит** фотографию: `thumbnailPhoto` из AD не читается
/// вовсе — аватары на фронте буквенные, а кэш остаётся компактным.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Employee {
    pub object_guid: String,
    pub source_org: String,
    pub sam_account_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub middle_name: Option<String>,
    pub display_name: Option<String>,
    pub title: Option<String>,
    pub department: Option<String>,
    pub company: Option<String>,
    pub office: Option<String>,
    pub email: Option<String>,
    pub ip_phone: Option<String>,
    pub phone_external: Option<String>,
    pub phone_mobile: Option<String>,
    pub manager: Option<String>,
    pub usn_changed: Option<i64>,
    pub updated_at: Option<i64>,
    /// TrueConf ID (AD-атрибут `pager`).
    pub pager: Option<String>,
}

/// Запись, подготовленная сервисом синхронизации для вставки в БД.
///
/// Текстовые значения (организация, подразделение, кабинет) нормализуются
/// в справочники на стороне БД — [`Db::replace_org_users`].
pub struct UserRecord {
    pub object_guid: String,
    pub sam_account_name: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub middle_name: Option<String>,
    pub display_name: String,
    pub sort_key: String,
    pub title: Option<String>,
    pub department: Option<String>,
    pub company: Option<String>,
    pub office: Option<String>,
    pub email: Option<String>,
    pub ip_phone: Option<String>,
    pub phone_external: Option<String>,
    pub phone_mobile: Option<String>,
    pub manager: Option<String>,
    /// TrueConf ID (AD-атрибут `pager`).
    pub pager: Option<String>,
    pub usn_changed: Option<i64>,
    /// Служебная строка токенов для FTS (инициалы, e-mail, «хвосты» телефонов).
    pub tokens: String,
}

/// Страница выдачи поиска: сами контакты + ТОЧНОЕ общее число совпадений
/// (без LIMIT) — сайдбар показывает полное количество, а не «300+».
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub items: Vec<Employee>,
    pub total: u64,
}

/// Параметры команды `search_contacts`.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
    /// Объединение организаций (группа фильтров из настроек): каждое имя
    /// разрешается в ключ справочника `orgs` (точное совпадение либо
    /// единственный содержащий его справочник), выдача учитывает союз.
    /// `Some(пустой список)` после разрешения — «не выдавать ничего»
    /// (ни одна организация группы не найдена в AD); `None` — фильтра нет.
    /// Пара с `source_org` — маркер фолбэка на источник синхронизации,
    /// когда группа не разрешилась ни в один справочник.
    #[serde(default)]
    pub organizations: Option<Vec<String>>,
    /// Фильтр по организации-источнику синхронизации: в отличие от
    /// `organization` (атрибут AD `company`), включает и учётки с незаполненной
    /// организацией — например сервисные. Вкладка предприятия передаёт его
    /// только парой с `organization` (то же имя): это маркер фолбэка для
    /// [`crate::services::db::read`] на случай, если имя из настроек не
    /// совпадает ни с одним `company` в AD.
    #[serde(default)]
    pub source_org: Option<String>,
    #[serde(default)]
    pub department: Option<String>,
    /// Точная выборка по GUID (вкладка «Мои контакты»).
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    /// Скрывать учётки без почты и телефонов (мусорные/системные).
    /// По умолчанию включено: IPC-клиент может вообще не прислать ключ.
    #[serde(default = "default_hide_empty")]
    pub hide_empty: bool,
    #[serde(default)]
    pub limit: Option<u32>,
}

/// IPC-значение по умолчанию для [`SearchParams::hide_empty`].
fn default_hide_empty() -> bool {
    true
}

/// Метаданные последней синхронизации организации.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgSyncMeta {
    pub organization: String,
    pub last_sync_at: Option<i64>,
    pub last_count: Option<i64>,
    pub last_error: Option<String>,
}
