//! Разбор записей каталога: бинарные атрибуты AD и карточка сотрудника.

use std::collections::HashMap;

use ldap3::{ResultEntry, SearchEntry};

use super::model::RawUser;

pub(super) fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Регистронезависимый поиск строкового атрибута (AD возвращает имена
/// атрибутов в своём регистре: `dnsHostName`, `sAMAccountName`, ...).
pub(super) fn attr_ci(entry: &SearchEntry, name: &str) -> Option<String> {
    entry
        .attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .and_then(|(_, values)| values.first())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(super) fn map_entry(raw: ResultEntry) -> RawUser {
    let entry = SearchEntry::construct(raw);

    // Нормализуем имена атрибутов к нижнему регистру.
    let attrs: HashMap<String, Vec<String>> = entry
        .attrs
        .into_iter()
        .map(|(key, values)| (key.to_lowercase(), values))
        .collect();
    let bins: HashMap<String, Vec<Vec<u8>>> = entry
        .bin_attrs
        .into_iter()
        .map(|(key, values)| (key.to_lowercase(), values))
        .collect();

    let text = |name: &str| -> Option<String> {
        attrs
            .get(name)
            .and_then(|values| values.first())
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    // ldap3 кладёт значение в bin_attrs только если оно НЕ валидный UTF-8.
    // uSNChanged (8 байт, часто < 0x80) и иногда objectGUID попадают в attrs —
    // возвращаем исходные байты через as_bytes().
    let binary = |name: &str| -> Option<Vec<u8>> {
        if let Some(value) = bins.get(name).and_then(|values| values.first()) {
            return Some(value.clone());
        }
        attrs
            .get(name)
            .and_then(|values| values.first())
            .map(|s| s.as_bytes().to_vec())
    };

    let dn = entry.dn.clone();
    let object_guid = binary("objectguid")
        .as_deref()
        .and_then(decode_object_guid)
        .unwrap_or_else(|| format!("dn:{dn}"));

    let usn_changed = binary("usnchanged").as_deref().and_then(decode_usn_changed);

    RawUser {
        dn,
        object_guid,
        sam_account_name: text("samaccountname"),
        first_name: text("givenname"),
        last_name: text("sn"),
        // В русскоязычном AD в `initials` обычно хранят отчество.
        middle_name: text("initials"),
        display_name: text("displayname"),
        title: text("title"),
        department: text("department"),
        company: text("company"),
        office: text("physicaldeliveryofficename"),
        email: text("mail"),
        ip_phone: text("ipphone"),
        phone_external: text("telephonenumber"),
        phone_mobile: text("mobile"),
        manager_dn: text("manager"),
        pager: text("pager"),
        user_account_control: text("useraccountcontrol").and_then(|value| value.parse().ok()),
        usn_changed,
    }
}

/// Декодирование бинарного `objectGUID` AD (смешанный порядок байт)
/// в каноническую UUID-строку.
pub fn decode_object_guid(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 16 {
        return None;
    }
    let d1 = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let d2 = u16::from_le_bytes([bytes[4], bytes[5]]);
    let d3 = u16::from_le_bytes([bytes[6], bytes[7]]);
    let tail: String = bytes[8..16].iter().map(|b| format!("{b:02x}")).collect();
    Some(format!(
        "{d1:08x}-{d2:04x}-{d3:04x}-{}-{}",
        &tail[..4],
        &tail[4..]
    ))
}

/// `uSNChanged` — 8-байтовое big-endian целое.
pub fn decode_usn_changed(bytes: &[u8]) -> Option<i64> {
    if bytes.len() != 8 {
        return None;
    }
    Some(i64::from_be_bytes(bytes.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ad_object_guid() {
        // Первые три группы little-endian, хвост — big-endian (формат AD).
        let bytes = [
            0x78, 0x56, 0x34, 0x12, // 0x12345678 LE
            0x34, 0x12, // 0x1234 LE
            0x78, 0x56, // 0x5678 LE
            0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34, 0x56, 0x78,
        ];
        assert_eq!(
            decode_object_guid(&bytes).as_deref(),
            Some("12345678-1234-5678-9abc-def012345678")
        );
        assert_eq!(decode_object_guid(&bytes[..8]), None);
    }

    #[test]
    fn decodes_usn_changed() {
        let bytes = 0x0000_0001_0000_0002_i64.to_be_bytes();
        assert_eq!(decode_usn_changed(&bytes), Some(0x0000_0001_0000_0002));
        assert_eq!(decode_usn_changed(&[0; 7]), None);
    }
}
