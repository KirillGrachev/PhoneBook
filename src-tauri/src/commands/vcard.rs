//! vCard generation for a contact QR code.

use crate::services::vcard::{self, VCardInput};

#[tauri::command]
pub fn generate_vcard(contact: VCardInput) -> String {
    vcard::generate(&contact)
}
