#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(xml) = std::str::from_utf8(data) {
        let _ = phonebook_xml::parse_phonebook_xml(xml);
    }
});
