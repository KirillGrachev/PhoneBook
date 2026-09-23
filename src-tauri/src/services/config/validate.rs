//! Валидация и нормализация входных данных конфигурации.

use crate::error::AppError;

use super::model::{default_language, default_theme, LdapOrgConfig, LdapOrgInput, OrgGroup};

pub(super) fn validate_orgs(inputs: Vec<LdapOrgInput>) -> Result<Vec<LdapOrgConfig>, AppError> {
    let mut configs = Vec::with_capacity(inputs.len());
    let mut seen = std::collections::HashSet::new();

    for input in inputs {
        // Лишние пробелы схлопываются: «АО  Комбинат» и «АО Комбинат» —
        // одна организация, дублей-невидимок в фильтрах быть не должно.
        let organization = crate::services::tokens::collapse_spaces(input.organization.trim());
        if organization.is_empty() {
            return Err(AppError::Validation(
                "Название организации не может быть пустым".into(),
            ));
        }
        if !seen.insert(organization.to_lowercase()) {
            return Err(AppError::Validation(format!(
                "Организация «{organization}» указана дважды"
            )));
        }

        let ldap_url = input.ldap_url.trim().to_string();
        let url_ok = ldap_url.starts_with("ldap://") || ldap_url.starts_with("ldaps://");
        if !ldap_url.is_empty() && !url_ok {
            return Err(AppError::Validation(format!(
                "Адрес сервера «{ldap_url}» должен начинаться с ldap:// или ldaps://"
            )));
        }

        configs.push(LdapOrgConfig {
            organization,
            ldap_url,
            base_dn: input.base_dn.trim().to_string(),
            bind_dn: input
                .bind_dn
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            use_start_tls: input.use_start_tls,
            allow_invalid_tls: input.allow_invalid_tls,
            use_integrated_auth: input.use_integrated_auth,
            has_password: false, // заполняется при загрузке из keyring
        });
    }
    Ok(configs)
}

pub(super) fn normalize_theme(value: &str) -> String {
    match value {
        "light" | "dark" | "system" => value.to_string(),
        _ => default_theme(),
    }
}

pub(super) fn normalize_language(value: &str) -> String {
    match value {
        "ru" | "en" => value.to_string(),
        _ => default_language(),
    }
}

/// Валидация и нормализация групп организаций (объединённых фильтров).
///
/// Как и для организаций AD: пустые имена недопустимы, дубликаты имён и
/// идентификаторов отклоняются, состав группы приводится к непустым
/// уникальным названиям. Пустая организация внутри группы — не ошибка
/// (фронтенд мог прислать чернововой чип), а вот пустое имя группы —
/// ошибка валидации: без имени фильтр не отличить от другого.
pub(super) fn validate_org_groups(groups: Vec<OrgGroup>) -> Result<Vec<OrgGroup>, AppError> {
    let mut validated = Vec::with_capacity(groups.len());
    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_names = std::collections::HashSet::new();

    for group in groups {
        let id = group.id.trim().to_string();
        if id.is_empty() {
            return Err(AppError::Validation(
                "Идентификатор группы организаций не может быть пустым".into(),
            ));
        }
        if !seen_ids.insert(id.to_lowercase()) {
            return Err(AppError::Validation(format!(
                "Группа с идентификатором «{id}» указана дважды"
            )));
        }
        let name = crate::services::tokens::collapse_spaces(group.name.trim());
        if name.is_empty() {
            return Err(AppError::Validation(
                "Название группы организаций не может быть пустым".into(),
            ));
        }
        if !seen_names.insert(name.to_lowercase()) {
            return Err(AppError::Validation(format!(
                "Группа организаций «{name}» указана дважды"
            )));
        }

        let mut orgs = Vec::with_capacity(group.orgs.len());
        let mut seen_orgs = std::collections::HashSet::new();
        for org in group.orgs {
            let org = crate::services::tokens::collapse_spaces(org.trim());
            if org.is_empty() || !seen_orgs.insert(org.to_lowercase()) {
                continue;
            }
            orgs.push(org);
        }
        validated.push(OrgGroup { id, name, orgs });
    }
    Ok(validated)
}

/// Привязка вкладки «КМАруда» к группе: ссылка обязана указывать на
/// существующую группу, иначе вкладка использует организацию первого
/// (организация первого AD-подключения) вместо пустого списка.
pub(super) fn resolve_enterprise_group_id(
    groups: &[OrgGroup],
    id: Option<String>,
) -> Option<String> {
    let id = id?.trim().to_string();
    groups
        .iter()
        .find(|group| group.id.eq_ignore_ascii_case(&id))
        .map(|group| group.id.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(id: &str, name: &str, orgs: &[&str]) -> OrgGroup {
        OrgGroup {
            id: id.into(),
            name: name.into(),
            orgs: orgs.iter().map(|o| (*o).to_string()).collect(),
        }
    }

    #[test]
    fn trims_and_deduplicates_group_content() {
        let validated = validate_org_groups(vec![group(
            " g1 ",
            "  КМАруда  ",
            &[" АО Комбинат ", "", "ао комбинат", "АО Комбинат", "Рудник"],
        )])
        .expect("valid group");
        assert_eq!(validated.len(), 1);
        assert_eq!(validated[0].id, "g1");
        assert_eq!(validated[0].name, "КМАруда");
        // Регистр организации значим (отображаемое имя), дубли и пустые сняты.
        assert_eq!(validated[0].orgs, vec!["АО Комбинат", "Рудник"]);
    }

    #[test]
    fn rejects_empty_and_duplicate_group_names() {
        assert!(validate_org_groups(vec![group("g1", "  ", &["АО"])]).is_err());
        assert!(validate_org_groups(vec![
            group("g1", "КМАруда", &["АО"]),
            group("g2", "кмаруда", &["ООО"]),
        ])
        .is_err());
        assert!(validate_org_groups(vec![
            group("g1", "КМАруда", &["АО"]),
            group(" g1 ", "Другая", &["ООО"]),
        ])
        .is_err());
        assert!(validate_org_groups(vec![group("", "КМАруда", &["АО"])]).is_err());
    }

    #[test]
    fn organization_names_collapse_spaces() {
        // «АО  Комбинат» и «АО Комбинат» — одна организация: лишние пробелы
        // схлопываются, чтобы в фильтрах и группах не жило двойников.
        let configs = validate_orgs(vec![LdapOrgInput {
            organization: "  АО   Комбинат  КМАруда ".into(),
            ldap_url: "ldap://dc.kmaruda.ru".into(),
            base_dn: "DC=kmaruda,DC=ru".into(),
            bind_dn: None,
            use_start_tls: false,
            allow_invalid_tls: false,
            use_integrated_auth: true,
        }])
        .expect("valid");
        assert_eq!(configs[0].organization, "АО Комбинат КМАруда");
    }

    #[test]
    fn enterprise_group_id_must_reference_existing_group() {
        let groups = validate_org_groups(vec![group("g1", "КМАруда", &["АО"])]).expect("valid");
        assert_eq!(
            resolve_enterprise_group_id(&groups, Some("g1".into())),
            Some("g1".to_string())
        );
        assert_eq!(
            resolve_enterprise_group_id(&groups, Some("g2".into())),
            None
        );
        assert_eq!(resolve_enterprise_group_id(&groups, None), None);
    }
}
