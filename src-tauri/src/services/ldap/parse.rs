//! Parsing catalog records: binary AD attributes and the employee card.

use std::collections::HashMap;

use ldap3::{ResultEntry, SearchEntry};

use super::model::RawUser;

pub(super) fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Case-insensitive search for a string attribute (AD returns names
/// attributes in their own case: `dnsHostName`, `sAMAccountName`, ...).
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

    // We normalize attribute names to lower case.
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
    // ldap3 puts a value into bin_attrs only if it is NOT valid UTF-8.
    // uSNChanged (8 bytes, often < 0x80) and sometimes objectGUID land in attrs —
    // return the original bytes via as_bytes().
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
        // In a Russian-speaking AD the middle name is usually stored in `initials`.
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
        photo: binary("thumbnailphoto").and_then(normalize_photo),
    }
}

/// Upper bound for a stored avatar (AD `thumbnailPhoto` is meant to be small).
/// Anything larger is almost certainly not a thumbnail and would bloat the cache.
const MAX_PHOTO_BYTES: usize = 256 * 1024;

/// Keeps only plausible image payloads: non-empty, within the size cap and
/// starting with a known image magic (JPEG/PNG/GIF/BMP). Returns the bytes
/// unchanged so the original format is preserved for the data URL.
pub(super) fn normalize_photo(bytes: Vec<u8>) -> Option<Vec<u8>> {
    if bytes.is_empty() || bytes.len() > MAX_PHOTO_BYTES {
        return None;
    }
    let is_image = bytes.starts_with(&[0xFF, 0xD8, 0xFF]) // JPEG
        || bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) // PNG
        || bytes.starts_with(b"GIF8") // GIF
        || bytes.starts_with(b"BM"); // BMP
    is_image.then_some(bytes)
}

/// Decoding the binary AD `objectGUID` (mixed byte order)
/// into a canonical UUID string.
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

/// `uSNChanged` is an 8-byte big-endian integer.
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
        // The first three groups are little-endian, the tail is big-endian (AD format).
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

    #[test]
    fn normalize_photo_keeps_images_and_rejects_junk() {
        let jpeg = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10];
        assert_eq!(normalize_photo(jpeg.clone()), Some(jpeg));
        let png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A];
        assert_eq!(normalize_photo(png.clone()), Some(png));
        assert_eq!(normalize_photo(vec![]), None);
        assert_eq!(normalize_photo(b"not an image".to_vec()), None);
        assert_eq!(normalize_photo(vec![0xFF; MAX_PHOTO_BYTES + 1]), None);
    }
}
