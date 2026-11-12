//! Unit-тесты кэша: поиск, фильтры, синхронизация, справочники, схема.

use super::*;

fn record(guid: &str, org: &str, display: &str, department: &str, phone_tail: &str) -> UserRecord {
    let tokens = crate::services::tokens::initials_tokens(display).join(" ");
    UserRecord {
        object_guid: guid.into(),
        sam_account_name: Some(guid.into()),
        first_name: None,
        last_name: None,
        middle_name: None,
        display_name: display.into(),
        sort_key: crate::services::tokens::sort_key(display),
        title: Some("Специалист".into()),
        department: Some(department.into()),
        company: Some(org.into()),
        office: Some("Каб. 101".into()),
        email: Some(format!("{guid}@kmaruda.ru")),
        ip_phone: Some(format!("56{phone_tail}")),
        phone_external: Some(format!("+7 (495) 123-{phone_tail}-89")),
        phone_mobile: None,
        manager: None,
        manager_guid: None,
        pager: None,
        usn_changed: Some(1),
        tokens,
    }
}

fn sample_db() -> Db {
    let db = Db::open_in_memory().expect("in-memory db");
    db.replace_org_users(
        "КМАруда",
        &[
            record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11"),
            record("g2", "КМАруда", "Петров Пётр Петрович", "Бухгалтерия", "22"),
        ],
    )
    .expect("sync org 1");
    db.replace_org_users(
        "Глобал Строй",
        &[record("g3", "Глобал Строй", "Смирнова Анна", "Кадры", "33")],
    )
    .expect("sync org 2");
    db
}

/// Число строк в таблице — для проверок дедупликации справочников.
fn table_count(db: &Db, table: &str) -> i64 {
    let guard = db.conn_for_tests().lock().expect("lock");
    guard
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("count")
}

#[test]
fn browse_returns_everything_sorted() {
    let db = sample_db();
    let all = db.search(SearchParams::default()).expect("browse").items;
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].display_name.as_deref(), Some("Иванов Иван Иванович"));
}

#[test]
fn hide_empty_toggle_filters_accounts_without_contacts() {
    let db = Db::open_in_memory().expect("in-memory db");
    let mut empty = record("g4", "КМАруда", "Пустой Пользователь", "IT отдел", "44");
    empty.email = None;
    empty.ip_phone = None;
    empty.phone_external = None;
    empty.phone_mobile = None;
    db.replace_org_users(
        "КМАруда",
        &[
            record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11"),
            empty,
        ],
    )
    .expect("sync");

    let hidden = db
        .search(SearchParams {
            hide_empty: true,
            ..Default::default()
        })
        .expect("search hidden");
    assert_eq!(hidden.total, 1, "учётка без почты и телефонов скрыта");
    assert_eq!(hidden.items[0].object_guid, "g1");

    let shown = db
        .search(SearchParams {
            hide_empty: false,
            ..Default::default()
        })
        .expect("search shown");
    assert_eq!(shown.total, 2, "выключенный тумблер показывает все учётки");
}

#[test]
fn searches_by_name_prefix() {
    let db = sample_db();
    let found = db
        .search(SearchParams {
            query: Some("иван".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].object_guid, "g1");
}

#[test]
fn searches_by_full_email() {
    let db = sample_db();
    // Адрес целиком: FTS-токенизатор режет его на части, запрос должен
    // требовать все части, а не искать один склеенный токен.
    let found = db
        .search(SearchParams {
            query: Some("g1@kmaruda.ru".into()),
            ..Default::default()
        })
        .expect("email search")
        .items;
    assert_eq!(found.len(), 1, "найден ровно один адрес: {found:?}");
    assert_eq!(found[0].object_guid, "g1");

    let upper = db
        .search(SearchParams {
            query: Some("G1@KMARUDA.RU".into()),
            ..Default::default()
        })
        .expect("email search uppercase");
    assert_eq!(upper.total, 1, "регистр адреса не важен");
}

#[test]
fn searches_by_phone_tail_ignoring_formatting() {
    let db = sample_db();
    let found = db
        .search(SearchParams {
            query: Some("22-89".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].object_guid, "g2");
}

#[test]
fn searches_with_wrong_keyboard_layout() {
    let db = sample_db();
    // «gtnhjd» — «петров», набранное в английской раскладке.
    let found = db
        .search(SearchParams {
            query: Some("gtnhjd".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert!(
        found.iter().any(|e| e.object_guid == "g2"),
        "найден Петров: {found:?}"
    );
}

#[test]
fn substring_match_works_via_trigram_index() {
    let db = sample_db();
    // «хгал» — подстрока в середине слова «Бухгалтерия», FTS-префикс её не берёт.
    let found = db
        .search(SearchParams {
            query: Some("хгал".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].object_guid, "g2");
}

#[test]
fn trigram_substring_search_is_case_insensitive() {
    let db = sample_db();
    // Запрос в верхнем регистре находит строчное значение: hay хранится
    // в lower, запрос нормализуется так же.
    let upper = db
        .search(SearchParams {
            query: Some("БУХГ".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(upper.total, 1, "верхний регистр находит строчное значение");
}

#[test]
fn null_fts_guid_does_not_break_complement_count() {
    let db = sample_db();
    // Защита от трёхзначной логики NOT IN: строка FTS с NULL-guid не должна
    // обнулять дополнительную выдачу (object_guid в рабочей базе всегда есть,
    // но защита дешёвая и фиксирует контракт).
    {
        let conn = db.conn_for_tests().lock().expect("lock");
        conn.execute(
            "INSERT INTO users_fts (object_guid, display_name) VALUES (NULL, 'фантом')",
            [],
        )
        .expect("insert null guid");
    }
    let found = db
        .search(SearchParams {
            query: Some("хгал".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(found.total, 1, "NULL-guid не ломает NOT IN: {found:?}");
    assert_eq!(found.items[0].object_guid, "g2");
}

#[test]
fn short_substring_still_found_via_like() {
    let db = sample_db();
    // Два символа: триграммам недоступно, работает LIKE-фолбэк.
    let found = db
        .search(SearchParams {
            query: Some("ух".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].object_guid, "g2");
}

#[test]
fn filters_by_organization_and_department() {
    let db = sample_db();
    let org = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("org filter")
        .items;
    assert_eq!(org.len(), 2);

    let dept = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            department: Some("Бухгалтерия".into()),
            ..Default::default()
        })
        .expect("dept filter")
        .items;
    assert_eq!(dept.len(), 1);
    assert_eq!(dept[0].object_guid, "g2");
}

#[test]
fn source_org_filter_includes_accounts_without_company() {
    let db = sample_db();
    // Сервисная учётка из AD «КМАруды» без атрибута company.
    let mut svc = record("g4", "КМАруда", "svc-backup", "IT отдел", "44");
    svc.company = None;
    db.replace_org_users(
        "КМАруда",
        &[
            record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11"),
            record("g2", "КМАруда", "Петров Пётр Петрович", "Бухгалтерия", "22"),
            svc,
        ],
    )
    .expect("resync");

    // Фильтр по атрибуту AD company сервисную учётку не включает.
    let by_company = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("org filter")
        .items;
    assert_eq!(by_company.len(), 2);
    assert!(!by_company.iter().any(|e| e.object_guid == "g4"));

    // Фильтр по источнику синхронизации включает (вкладка «Предприятие»).
    let by_source = db
        .search(SearchParams {
            source_org: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("source filter")
        .items;
    assert_eq!(by_source.len(), 3);
    assert!(by_source.iter().any(|e| e.object_guid == "g4"));
    assert!(
        !by_source.iter().any(|e| e.object_guid == "g3"),
        "чужая организация не попадает в выдачу"
    );

    // Список организаций для фильтра не содержит пустых имён.
    let orgs = db.list_organizations().expect("orgs");
    assert!(orgs.iter().all(|o| !o.trim().is_empty()));
}

#[test]
fn ids_selection_respects_limit_and_offset() {
    let db = sample_db();
    let page = db
        .search(SearchParams {
            ids: Some(vec!["g3".into(), "g1".into(), "g2".into()]),
            limit: Some(1),
            offset: Some(1),
            ..Default::default()
        })
        .expect("ids page");
    assert_eq!(page.total, 3);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].object_guid, "g2");
}

#[test]
fn by_ids_selection() {
    let db = sample_db();
    let picked = db
        .search(SearchParams {
            ids: Some(vec!["g3".into(), "g1".into()]),
            ..Default::default()
        })
        .expect("ids")
        .items;
    assert_eq!(picked.len(), 2);
    // Сортировка по алфавиту, а не по порядку id.
    assert_eq!(picked[0].object_guid, "g1");
}

#[test]
fn resync_removes_stale_rows_of_that_org_only() {
    let db = sample_db();
    // Повторная синхронизация КМАруды: Иванов «уволен».
    db.replace_org_users(
        "КМАруда",
        &[record(
            "g2",
            "КМАруда",
            "Петров Пётр Петрович",
            "Бухгалтерия",
            "22",
        )],
    )
    .expect("resync");

    assert!(db.get_by_id("g1").is_err(), "Иванов удалён");
    assert!(db.get_by_id("g2").is_ok());
    assert!(db.get_by_id("g3").is_ok(), "другая организация не тронута");
    assert_eq!(db.count().expect("count"), 2);

    // FTS не должен возвращать «призраков».
    let ghosts = db
        .search(SearchParams {
            query: Some("иванов".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert!(ghosts.is_empty());
}

#[test]
fn sync_meta_tracks_success_and_errors() {
    let db = sample_db();
    let meta = db.sync_meta().expect("meta");
    assert_eq!(meta.len(), 2);
    let kma = meta
        .iter()
        .find(|m| m.organization == "КМАруда")
        .expect("kma");
    assert_eq!(kma.last_count, Some(2));
    assert!(kma.last_error.is_none());
    assert!(kma.last_sync_at.unwrap() > 0);
    assert_eq!(kma.last_usn, Some(1));
    assert!(kma.last_full_sync_at.is_some());

    db.set_sync_error("КМАруда", "сервер недоступен")
        .expect("set error");
    let meta = db.sync_meta().expect("meta");
    let kma = meta.iter().find(|m| m.organization == "КМАруда").unwrap();
    assert_eq!(kma.last_error.as_deref(), Some("сервер недоступен"));
}

#[test]
fn shared_cache_serialize_restore_roundtrip() {
    let flags = OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE;
    let uri = format!(
        "file:phonebook-enc-{}-{}?mode=memory&cache=shared",
        std::process::id(),
        unix_now()
    );
    let mut source = Connection::open_with_flags(&uri, flags).expect("source");
    source
        .execute_batch("CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES ('ok');")
        .expect("seed");
    let bytes = encryption::serialize(&mut source).expect("serialize");

    let target_uri = format!(
        "file:phonebook-enc-restored-{}-{}?mode=memory&cache=shared",
        std::process::id(),
        unix_now()
    );
    let mut target = Connection::open_with_flags(&target_uri, flags).expect("target");
    encryption::restore(&mut target, &bytes).expect("restore");
    let value: String = target
        .query_row("SELECT value FROM probe", [], |row| row.get(0))
        .expect("query");
    assert_eq!(value, "ok");
}

#[test]
fn email_with_underscore_is_searchable() {
    let db = sample_db();
    let mut user = record("g1", "КМАруда", "Грачёв Кирилл", "ИТ", "11");
    user.email = Some("Grachev_ke@metholding.com".into());
    user.usn_changed = Some(2);
    user.tokens = format!(
        "{} {}",
        user.tokens,
        crate::services::tokens::email_tokens("Grachev_ke@metholding.com").join(" ")
    );
    db.replace_org_users("КМАруда", &[user]).expect("seed");
    let page = db
        .search(SearchParams {
            query: Some("Grachev_ke@metholding.com".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(page.total, 1);
    assert_eq!(
        page.items[0].email.as_deref(),
        Some("Grachev_ke@metholding.com")
    );
}

#[test]
fn shared_cache_readers_serve_search() {
    let db = Db::open_shared_in_memory().expect("shared db");
    db.replace_org_users(
        "КМАруда",
        &[record("g1", "КМАруда", "Иванов Иван", "ИТ", "11")],
    )
    .expect("seed");
    let page = db
        .search(SearchParams {
            query: Some("Иванов".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(page.total, 1);
}

#[test]
fn reader_without_schema_falls_back_to_main_connection() {
    let base = sample_db();
    let db = Db {
        conn: Arc::clone(&base.conn),
        path: None,
        key: [0u8; 32],
        search_generation: Arc::new(AtomicU64::new(0)),
        search_cache: Arc::new(Mutex::new(SearchCache::default())),
        // Пустая БД без схемы ведёт себя как сломанный shared-cache reader.
        readers: Arc::new(Mutex::new(vec![
            Connection::open_in_memory().expect("empty reader")
        ])),
    };

    let page = db
        .search(SearchParams {
            query: Some("Иванов".into()),
            ..Default::default()
        })
        .expect("fallback search");
    assert!(page.total > 0);
}

#[test]
fn search_cache_is_invalidated_by_writes() {
    let db = sample_db();
    let params = SearchParams {
        query: Some("Иванов".into()),
        ..Default::default()
    };
    assert!(db.search(params.clone()).expect("before").total > 0);

    let mut changed = record("g1", "КМАруда", "Сидоров Сидор", "ИТ отдел", "11");
    changed.usn_changed = Some(2);
    db.replace_org_users("КМАруда", &[changed]).expect("write");

    assert_eq!(db.search(params).expect("after").total, 0);
}

#[test]
fn delta_merge_does_not_delete_absent_users_and_tracks_usn() {
    let db = sample_db();
    let mut changed = record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11");
    changed.display_name = "Иванов Иван Обновлённый".into();
    changed.usn_changed = Some(2);
    let total = db.merge_org_users("КМАруда", &[changed]).expect("merge");
    assert_eq!(total, 2, "g2 не удалён дельтой");
    let meta = db.sync_meta().expect("meta");
    let kma = meta
        .iter()
        .find(|m| m.organization == "КМАруда")
        .expect("kma");
    assert_eq!(kma.last_count, Some(2));
    assert_eq!(kma.last_usn, Some(2));
}

#[test]
fn organizations_are_distinct_and_sorted() {
    let db = sample_db();
    let orgs = db.list_organizations().expect("orgs");
    assert_eq!(
        orgs,
        vec!["Глобал Строй".to_string(), "КМАруда".to_string()]
    );
}

#[test]
fn like_wildcards_do_not_leak_into_pattern() {
    let db = sample_db();
    // Символы LIKE/FTS в запросе игнорируются (санитизация), а не работают
    // как wildcards: одиночный «%» равносилен пустому запросу (просмотру).
    let wildcard = db
        .search(SearchParams {
            query: Some("%".into()),
            ..Default::default()
        })
        .expect("search");
    let browse = db.search(SearchParams::default()).expect("browse");
    assert_eq!(wildcard.total, browse.total);

    // Пунктуация внутри слова не мешает поиску: «Иван_ов» ищет как «Иванов».
    let underscore = db
        .search(SearchParams {
            query: Some("Иван_ов".into()),
            ..Default::default()
        })
        .expect("search");
    assert!(underscore.total >= 1);
}

#[test]
fn lookups_store_repeated_values_once() {
    let db = sample_db();
    // 3 сотрудника, 2 организации, 3 отдела, один кабинет на всех.
    assert_eq!(table_count(&db, "users"), 3);
    assert_eq!(table_count(&db, "sources"), 2, "КМАруда и Глобал Строй");
    assert_eq!(table_count(&db, "orgs"), 2);
    assert_eq!(table_count(&db, "departments"), 3);
    assert_eq!(
        table_count(&db, "locations"),
        1,
        "одинаковый кабинет хранится одной строкой"
    );
}

#[test]
fn unchanged_usn_skips_index_rewrite_but_changed_usn_updates() {
    let db = sample_db();
    // Тот же uSNChanged: запись считается неизменённой, даже если в тестовом
    // объекте поменяли поле (в AD такое невозможно без роста uSNChanged).
    let mut same = record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11");
    same.display_name = "Подмена без uSNChanged".into();
    db.replace_org_users("КМАруда", &[same]).expect("same usn");
    let page = db
        .search(SearchParams {
            query: Some("Иванов".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(
        page.items[0].display_name.as_deref(),
        Some("Иванов Иван Иванович")
    );

    // Новый uSNChanged — запись переиндексируется.
    let mut changed = record("g1", "КМАруда", "Иванов Иван Иванович", "IT отдел", "11");
    changed.display_name = "Иванов Иван Обновлённый".into();
    changed.usn_changed = Some(2);
    db.replace_org_users("КМАруда", &[changed])
        .expect("changed usn");
    let page = db
        .search(SearchParams {
            query: Some("Обновлённый".into()),
            ..Default::default()
        })
        .expect("search changed");
    assert_eq!(page.items[0].object_guid, "g1");
}

#[test]
fn stale_sync_prunes_unused_lookups() {
    let db = sample_db();
    // Петров переведён в «Кадры» без кабинета, Иванов уволен:
    // «IT отдел» и «Бухгалтерия» больше никому не нужны.
    let mut moved = record("g2", "КМАруда", "Петров Пётр Петрович", "Кадры", "22");
    moved.office = None;
    moved.usn_changed = Some(2); // AD поднял uSNChanged при переводе
    db.replace_org_users("КМАруда", &[moved]).expect("resync");

    let guard = db.conn_for_tests().lock().expect("lock");
    let mut stmt = guard
        .prepare("SELECT name FROM departments ORDER BY name")
        .expect("prepare");
    let names: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .expect("query")
        .filter_map(Result::ok)
        .collect();
    assert_eq!(names, vec!["Кадры".to_string()]);
    // «Каб. 101» по-прежнему нужен Смирновой из другой организации.
    drop(stmt);
    // Мьютекс соединения нерентерабелен: освобождаем до обращения к table_count.
    drop(guard);
    assert_eq!(table_count(&db, "locations"), 1);
}

#[test]
fn foreign_keys_are_enforced() {
    let db = sample_db();
    let guard = db.conn_for_tests().lock().expect("lock");
    let inserted = guard.execute(
        "INSERT INTO users (object_guid, source_id, display_name, sort_key, updated_at)
             VALUES ('ghost', 9999, 'Призрак', 'призрак', 0)",
        [],
    );
    assert!(
        inserted.is_err(),
        "ссылка на несуществующий источник должна отклоняться"
    );
}

#[test]
fn organizations_deduplicate_case_and_spaces() {
    let db = sample_db();
    // Варианты написания организации: регистр и лишние пробелы.
    let mut first = record("d1", "Тест", "Один Иванов", "Отдел", "31");
    first.company = Some("ТЕСТ".into());
    let mut second = record("d2", "Тест", "Два Иванов", "Отдел", "32");
    second.company = Some("Тест ".into());
    db.replace_org_users("Тест", &[first, second])
        .expect("sync");

    let orgs = db.list_organizations().expect("orgs");
    let test_orgs: Vec<&String> = orgs
        .iter()
        .filter(|o| o.to_lowercase().trim() == "тест")
        .collect();
    assert_eq!(
        test_orgs.len(),
        1,
        "варианты регистра/пробелов дедуплицируются: {orgs:?}"
    );
    assert_eq!(
        test_orgs[0], "Тест",
        "отображаемый вариант — смешанный регистр, а не капс"
    );
}

#[test]
fn limit_is_respected_but_total_is_exact() {
    let db = sample_db();
    let page = db
        .search(SearchParams {
            limit: Some(2),
            ..Default::default()
        })
        .expect("browse");
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.total, 3, "total — полное число контактов, без limit");
}

#[test]
fn latin_names_sort_after_cyrillic() {
    let db = sample_db();
    db.replace_org_users(
        "КМАруда",
        &[
            record("z1", "КМАруда", "adm-service", "IT отдел", "91"),
            record("z2", "КМАруда", "Абакин Пётр", "IT отдел", "92"),
        ],
    )
    .expect("sync");
    let page = db.search(SearchParams::default()).expect("browse");
    let first = page.items[0].display_name.as_deref().unwrap_or_default();
    let first_lower = first.to_lowercase();
    assert!(
        first_lower
            .chars()
            .next()
            .map(|c| matches!(c, 'а'..='я' | 'ё'))
            .unwrap_or(false),
        "первым должен быть контакт на кириллице, получен: {first}"
    );
    let last = page
        .items
        .last()
        .unwrap()
        .display_name
        .as_deref()
        .unwrap_or_default();
    assert_eq!(last, "adm-service");
}

#[test]
fn organization_filter_resolves_settings_name_to_company() {
    // Имя из настроек AD («КМАруда») отличается от атрибута company
    // («АО Комбинат КМАруда»): фильтр предприятия должен найти единственный
    // содержащий его справочник, а не отдать весь источник синхронизации.
    let db = Db::open_in_memory().expect("in-memory db");
    db.replace_org_users(
        "КМАруда",
        &[
            record("e1", "АО Комбинат КМАруда", "Иванов Иван", "Цех", "41"),
            record("e2", "АО Комбинат КМАруда", "Петров Пётр", "Цех", "42"),
        ],
    )
    .expect("sync source 1");
    db.replace_org_users(
        "Глобал Строй",
        &[record("e3", "Глобал Строй", "Смирнова Анна", "Кадры", "43")],
    )
    .expect("sync source 2");

    let found = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            source_org: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(found.total, 2);
}

#[test]
fn organization_filter_falls_back_to_source_when_company_unknown() {
    // Имя из настроек не встречается ни в одном company: пара
    // organization+source_org с тем же именем деградирует до фильтра по
    // источнику; строгий organization-фильтр без дубля остаётся строгим.
    let db = Db::open_in_memory().expect("in-memory db");
    db.replace_org_users(
        "КМАруда",
        &[
            record("e1", "Комбинат Рудный", "Иванов Иван", "Цех", "41"),
            record("e2", "Комбинат Рудный", "Петров Пётр", "Цех", "42"),
        ],
    )
    .expect("sync source");

    let fallback = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            source_org: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(fallback.total, 2);

    let strict = db
        .search(SearchParams {
            organization: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(strict.total, 0);
}

#[test]
fn encrypted_container_full_lifecycle() {
    // Полный цикл зашифрованного кэша: память → контейнер на диске →
    // память, на реальной схеме (справочники + FTS5 + триггеры).
    let dir = std::env::temp_dir().join(format!("kmpb-lifecycle-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("phonebook.db");
    encryption::wipe_database_files(&path).expect("clean");

    let key = encryption::generate_key().expect("key");

    // 1. Наполняем in-memory базу через обычный путь синхронизации.
    let db = Db::open_in_memory().expect("open");
    db.replace_org_users(
        "КМАруда",
        &[record("g1", "КМАруда", "Смирнов Иван", "ИТ", "11")],
    )
    .expect("sync");
    let image = {
        let mut conn = db.lock();
        encryption::serialize(&mut conn).expect("serialize")
    };

    // 2. На диске — только контейнер: ни SQLite-заголовка, ни данных.
    encryption::save(&path, &key, &image).expect("save");
    let raw = std::fs::read(&path).expect("read");
    assert!(raw.starts_with(b"KMPBENC1"));
    assert!(!raw.windows(16).any(|w| w == b"SQLite format 3\0"));
    assert!(!String::from_utf8_lossy(&raw).contains("Смирнов"));

    // 3. Загрузка с тем же ключом восстанавливает базу целиком.
    let restored = match encryption::load(&path, &key).expect("load") {
        encryption::LoadOutcome::Bytes(bytes) => bytes,
        other => panic!("unexpected outcome: {other:?}"),
    };
    let mut conn = Connection::open_in_memory().expect("conn");
    encryption::restore(&mut conn, &restored).expect("restore");
    let db2 = Db {
        conn: Arc::new(Mutex::new(conn)),
        path: Some(path.clone()),
        key,
        search_generation: Arc::new(AtomicU64::new(0)),
        search_cache: Arc::new(Mutex::new(SearchCache::default())),
        readers: Arc::new(Mutex::new(Vec::new())),
    };
    assert_eq!(db2.count().expect("count"), 1);

    // Полнотекстовый поиск пережил serialize/deserialize.
    let page = db2
        .search(SearchParams {
            query: Some("Смир".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].display_name.as_deref(), Some("Смирнов Иван"));

    // 4. Запись во восстановленной базе сама обновляет контейнер (flush).
    db2.replace_org_users(
        "КМАруда",
        &[
            record("g1", "КМАруда", "Смирнов Иван", "ИТ", "11"),
            record("g2", "КМАруда", "Петров Пётр", "ИТ", "22"),
        ],
    )
    .expect("sync 2");
    match encryption::load(&path, &key).expect("load 2") {
        encryption::LoadOutcome::Bytes(bytes) => {
            let mut conn = Connection::open_in_memory().expect("conn");
            encryption::restore(&mut conn, &bytes).expect("restore");
            let db3 = Db {
                conn: Arc::new(Mutex::new(conn)),
                path: None,
                key: [0u8; 32],
                search_generation: Arc::new(AtomicU64::new(0)),
                search_cache: Arc::new(Mutex::new(SearchCache::default())),
                readers: Arc::new(Mutex::new(Vec::new())),
            };
            assert_eq!(db3.count().expect("count"), 2);
        }
        other => panic!("unexpected outcome: {other:?}"),
    }

    encryption::wipe_database_files(&path).expect("wipe");
    assert!(!path.exists());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn search_handles_five_thousand_records() {
    let db = Db::open_in_memory().expect("db");
    let users = (0..5_000)
        .map(|i| {
            record(
                &format!("load-{i}"),
                "Load Test",
                &format!("Load User {i:05}"),
                "Operations",
                &format!("{:04}", i % 10_000),
            )
        })
        .collect::<Vec<_>>();
    db.replace_org_users("Load Test", &users).expect("load");

    let started = std::time::Instant::now();
    let page = db
        .search(SearchParams {
            query: Some("Load User 04999".into()),
            ..Default::default()
        })
        .expect("search");
    assert!(page.total > 0, "5k-record search returned no rows");
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
}

#[test]
fn corrupt_or_truncated_container_is_rejected() {
    let dir = std::env::temp_dir().join(format!(
        "kmpb-corrupt-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join("phonebook.db");
    let key = encryption::generate_key().expect("key");
    let image = b"not a sqlite image".to_vec();
    encryption::save(&path, &key, &image).expect("save");

    // Truncated container: header exists, ciphertext cannot be authenticated.
    let mut bytes = std::fs::read(&path).expect("read");
    bytes.truncate(12);
    std::fs::write(&path, &bytes).expect("truncate");
    assert!(matches!(
        encryption::load(&path, &key).expect("load"),
        encryption::LoadOutcome::Foreign
    ));

    // A container encrypted for another key must not restore either.
    encryption::save(&path, &key, &image).expect("save");
    let other_key = encryption::generate_key().expect("other key");
    assert!(matches!(
        encryption::load(&path, &other_key).expect("load"),
        encryption::LoadOutcome::Foreign
    ));

    encryption::wipe_database_files(&path).expect("wipe");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn multi_org_filter_unions_companies() {
    // Группа фильтров: союз организаций учитывает учётки каждой из них,
    // а не только первой (вкладка «КМАруда» не глобальной версии).
    let db = sample_db();
    let union = db
        .search(SearchParams {
            organizations: Some(vec!["КМАруда".into(), "Глобал Строй".into()]),
            ..Default::default()
        })
        .expect("union search");
    assert_eq!(union.total, 3);

    let single = db
        .search(SearchParams {
            organizations: Some(vec!["Глобал Строй".into()]),
            ..Default::default()
        })
        .expect("single search");
    assert_eq!(single.total, 1);
    assert_eq!(single.items[0].object_guid, "g3");
}

#[test]
fn multi_org_filter_resolves_variant_names() {
    // Имена группы могут отличаться от атрибута company (имя из настроек,
    // кавычки юридического лица): каждое разрешается в свой справочник.
    let db = Db::open_in_memory().expect("in-memory db");
    db.replace_org_users(
        "КМАруда",
        &[
            record("m1", "АО Комбинат КМАруда", "Иванов Иван", "Цех", "41"),
            record("m2", "АО Комбинат КМАруда", "Петров Пётр", "Цех", "42"),
            record(
                "m3",
                "ООО \"Рудник Северный\"",
                "Смирнова Анна",
                "Карьер",
                "43",
            ),
        ],
    )
    .expect("sync");

    let found = db
        .search(SearchParams {
            organizations: Some(vec!["Комбинат КМАруда".into(), "Рудник Северный".into()]),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(found.total, 3);

    // Дедупликация: оба имени группы указывают на один справочник.
    let dup = db
        .search(SearchParams {
            organizations: Some(vec![
                "Комбинат КМАруда".into(),
                "АО Комбинат КМАруда".into(),
            ]),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(dup.total, 2);
}

#[test]
fn multi_org_filter_without_resolution_matches_nothing() {
    // Строгая группа (без маркера source_org), чьи организации исчезли из
    // AD: выдача пуста, а не «весь холдинг».
    let db = sample_db();
    let found = db
        .search(SearchParams {
            organizations: Some(vec!["Нет такой организации".into()]),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(found.total, 0);
}

#[test]
fn multi_org_filter_falls_back_to_source_when_pair_given() {
    // Вкладка предприятия передаёт source_org маркером: ни одно имя группы
    // не найдено в company → фолбэк на источник синхронизации.
    let db = Db::open_in_memory().expect("in-memory db");
    db.replace_org_users(
        "КМАруда",
        &[
            record("f1", "Комбинат Рудный", "Иванов Иван", "Цех", "41"),
            record("f2", "Комбинат Рудный", "Петров Пётр", "Цех", "42"),
        ],
    )
    .expect("sync");

    let fallback = db
        .search(SearchParams {
            organizations: Some(vec!["КМАруда".into(), "Тоже нет".into()]),
            source_org: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(fallback.total, 2);

    // Частичное разрешение: учитываются только найденные организации,
    // фолбэк не подмешивает весь источник.
    let partial = db
        .search(SearchParams {
            organizations: Some(vec!["Комбинат Рудный".into(), "Тоже нет".into()]),
            source_org: Some("КМАруда".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(partial.total, 2);

    let unknown_source = db
        .search(SearchParams {
            organizations: Some(vec!["КМАруда".into()]),
            source_org: Some("Другой источник".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(unknown_source.total, 0);
}

#[test]
fn schema_version_mismatch_recreates_cache() {
    use super::schema::{ensure_schema, CREATE_SCHEMA, SCHEMA_VERSION};

    let conn = Connection::open_in_memory().expect("conn");
    Db::apply_pragmas(&conn).expect("pragmas");
    conn.execute_batch(CREATE_SCHEMA).expect("schema");
    conn.pragma_update(None, "user_version", 42).expect("stamp");
    conn.execute("INSERT INTO sources (name) VALUES ('КМАруда')", [])
        .expect("row");

    ensure_schema(&conn).expect("ensure");

    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("version");
    assert_eq!(version, SCHEMA_VERSION);
    let sources: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
        .expect("count");
    assert_eq!(sources, 0, "кэш пересоздан с нуля: зеркало восстановимо");

    // Повторный вызов на актуальной версии — no-op, данные не трогает.
    conn.execute("INSERT INTO sources (name) VALUES ('КМАруда')", [])
        .expect("row");
    ensure_schema(&conn).expect("ensure again");
    let sources: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
        .expect("count");
    assert_eq!(sources, 1, "совпадение версии — no-op");
}

#[test]
fn mixed_schema_structure_self_heals() {
    use super::schema::{ensure_schema, SCHEMA_VERSION};

    // База «смешанной» сборки: штамп версии актуальный, но в `sources`
    // нет колонки `kind` — ровно та картина, при которой синхронизация
    // внешнего файла падает на «no such column: kind».
    let conn = Connection::open_in_memory().expect("conn");
    Db::apply_pragmas(&conn).expect("pragmas");
    ensure_schema(&conn).expect("ensure");
    conn.execute_batch(
        "DROP TABLE sync_meta;
         DROP TABLE users;
         DROP TABLE sources;
         CREATE TABLE sources (
             id   INTEGER PRIMARY KEY,
             name TEXT NOT NULL UNIQUE
         );",
    )
    .expect("имитация смешанной сборки");
    conn.execute("INSERT INTO sources (name) VALUES ('КМАруда')", [])
        .expect("row");
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("version");
    assert_eq!(version, SCHEMA_VERSION, "штамп версии не менялся");

    // Самопроверка структуры замечает подмену и пересоздаёт кэш.
    ensure_schema(&conn).expect("self-heal");
    conn.prepare("SELECT kind FROM sources LIMIT 0")
        .expect("колонка kind вернулась");
    let sources: i64 = conn
        .query_row("SELECT COUNT(*) FROM sources", [], |row| row.get(0))
        .expect("count");
    assert_eq!(sources, 0, "кэш пересоздан с нуля: зеркало восстановимо");
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("version");
    assert_eq!(version, SCHEMA_VERSION);
}

#[test]
fn punctuation_in_query_does_not_break_search() {
    let db = sample_db();
    // Запятая и пунктуация санитизируются: «Смирнов, Иван» ищет то же,
    // что «Смирнов Иван», а не превращается в триграммную фразу с запятой.
    let with_comma = db
        .search(SearchParams {
            query: Some("Иванов, Иван".into()),
            ..Default::default()
        })
        .expect("search");
    let plain = db
        .search(SearchParams {
            query: Some("Иванов Иван".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(with_comma.total, plain.total);
    assert!(with_comma.total >= 1);
}

#[test]
fn punctuation_only_query_falls_back_to_browse() {
    let db = sample_db();
    // Одна запятая — не запрос: выдача равна просмотру без поиска.
    let comma = db
        .search(SearchParams {
            query: Some(",".into()),
            ..Default::default()
        })
        .expect("search");
    let browse = db.search(SearchParams::default()).expect("browse");
    assert_eq!(comma.total, browse.total);
}

#[test]
fn layout_variants_include_punctuation_mapping() {
    let db = sample_db();
    // `,j,f` на русской раскладке — это «боба»: раскладочный вариант
    // строится до отбрасывания пунктуации, запятая воспринимается как «б».
    let expr = crate::services::tokens::build_fts_query(",j,f").expect("expr");
    assert!(expr.contains("боба"), "вариант с запятой как «б»: {expr}");

    // Одиночная запятая равносильна поиску на «б».
    let comma = db
        .search(SearchParams {
            query: Some(",".into()),
            ..Default::default()
        })
        .expect("search");
    let bee = db
        .search(SearchParams {
            query: Some("б".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(comma.total, bee.total);
}

#[test]
fn comma_and_dot_reach_layout_letters() {
    let db = sample_db();
    // Запятая на русской раскладке — это «б»: находится «Бухгалтерия»,
    // хотя санитизация для триграмм/LIKE пунктуацию отбрасывает.
    let comma = db
        .search(SearchParams {
            query: Some(",".into()),
            ..Default::default()
        })
        .expect("search");
    assert!(comma.total >= 1);
    assert!(comma
        .items
        .iter()
        .any(|e| e.department.as_deref() == Some("Бухгалтерия")));

    // Точка — это «ю»: отдельная база с таким именем.
    let db2 = Db::open_in_memory().expect("db");
    db2.replace_org_users(
        "КМАруда",
        &[record("g9", "КМАруда", "Юдин Юлий", "Кадры", "77")],
    )
    .expect("sync");
    let dot = db2
        .search(SearchParams {
            query: Some(".".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(dot.total, 1);
    assert_eq!(dot.items[0].object_guid, "g9");
}

#[test]
fn offset_pages_are_disjoint_and_stable() {
    let db = sample_db();
    let first = db
        .search(SearchParams {
            limit: Some(2),
            offset: Some(0),
            ..Default::default()
        })
        .expect("page 0");
    let second = db
        .search(SearchParams {
            limit: Some(2),
            offset: Some(2),
            ..Default::default()
        })
        .expect("page 1");
    assert_eq!(first.items.len(), 2);
    assert_eq!(second.items.len(), 1);
    assert_eq!(first.total, 3);
    assert_eq!(second.total, 3, "total не зависит от порции");
    let guids: Vec<&str> = first
        .items
        .iter()
        .chain(second.items.iter())
        .map(|e| e.object_guid.as_str())
        .collect();
    let mut deduped = guids.clone();
    deduped.sort_unstable();
    deduped.dedup();
    assert_eq!(guids.len(), deduped.len(), "порции не пересекаются");
}

#[test]
fn mixed_fts_and_trigram_pages_are_exact() {
    let db = Db::open_in_memory().expect("in-memory db");
    let mut records = Vec::new();
    // 5 совпадений по префиксу FTS: «Иванов» — отдельный токен.
    for i in 0..5 {
        records.push(record(
            &format!("fts-{i}"),
            "КМАруда",
            "Иванов Иван",
            "IT отдел",
            "11",
        ));
    }
    // 5 совпадений только по триграмме: «иван» — подстрока «Поливанов».
    for i in 0..5 {
        records.push(record(
            &format!("sub-{i}"),
            "КМАруда",
            "Поливанов Пётр",
            "Бухгалтерия",
            "22",
        ));
    }
    db.replace_org_users("КМАруда", &records).expect("sync");

    let mut guids = Vec::new();
    for offset in [0, 4, 8] {
        let page = db
            .search(SearchParams {
                query: Some("Иван".into()),
                limit: Some(4),
                offset: Some(offset),
                ..Default::default()
            })
            .expect("search page");
        assert_eq!(page.total, 10, "total не зависит от страницы");
        guids.extend(page.items.into_iter().map(|item| item.object_guid));
    }
    assert_eq!(guids.len(), 10, "все страницы вместе дают всю выдачу");
    let mut unique = guids.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        10,
        "страницы не пересекаются и не теряют записи"
    );
}

#[test]
fn title_filter_finds_people_with_same_title() {
    let db = Db::open_in_memory().expect("db");
    let mut engineer = record("g1", "КМАруда", "Иванов Иван", "IT отдел", "11");
    engineer.title = Some("Инженер".into());
    let mut manager = record("g2", "КМАруда", "Петров Пётр", "IT отдел", "22");
    manager.title = Some("Начальник отдела".into());
    db.replace_org_users("КМАруда", &[engineer, manager])
        .expect("sync");

    let engineers = db
        .search(SearchParams {
            title: Some("Инженер".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(engineers.total, 1);
    assert_eq!(engineers.items[0].object_guid, "g1");
    let none = db
        .search(SearchParams {
            title: Some("Вертолётоводитель".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(none.total, 0);
}

#[test]
fn office_filter_finds_people_in_same_office() {
    let db = Db::open_in_memory().expect("db");
    let mut first = record("g1", "КМАруда", "Иванов Иван", "IT отдел", "11");
    first.office = Some("Каб. 401".into());
    let mut second = record("g2", "КМАруда", "Петров Пётр", "IT отдел", "22");
    second.office = Some("Каб. 401".into());
    let mut third = record("g3", "КМАруда", "Сидоров Сергей", "Бухгалтерия", "33");
    third.office = Some("Каб. 210".into());
    db.replace_org_users("КМАруда", &[first, second, third])
        .expect("sync");

    // Клик по кабинету: точный фильтр отдаёт только соседей по кабинету.
    let roommates = db
        .search(SearchParams {
            office: Some("Каб. 401".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(roommates.total, 2);
    let mut guids: Vec<&str> = roommates
        .items
        .iter()
        .map(|e| e.object_guid.as_str())
        .collect();
    guids.sort_unstable();
    assert_eq!(guids, vec!["g1", "g2"]);

    // Пустая строка кабинета фильтром не считается (как отдел/должность).
    let unfiltered = db
        .search(SearchParams {
            office: Some("   ".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(unfiltered.total, 3);

    let none = db
        .search(SearchParams {
            office: Some("Каб. 999".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(none.total, 0);
}

#[test]
fn manager_guid_roundtrips_to_employee() {
    let db = Db::open_in_memory().expect("db");
    let mut record = record("g1", "КМАруда", "Иванов Иван", "IT отдел", "11");
    record.manager = Some("Петров Пётр".into());
    record.manager_guid = Some("g0".into());
    db.replace_org_users("КМАруда", &[record]).expect("sync");
    let employee = db.get_by_id("g1").expect("employee");
    assert_eq!(employee.manager_guid.as_deref(), Some("g0"));
}

/// Запись внешнего телефонного файла: минимум полей, номер обязателен.
fn external_record(guid: &str, display: &str, phone: &str) -> UserRecord {
    let tokens = crate::services::tokens::initials_tokens(display).join(" ");
    UserRecord {
        object_guid: guid.into(),
        sam_account_name: None,
        first_name: None,
        last_name: None,
        middle_name: None,
        display_name: display.into(),
        sort_key: crate::services::tokens::sort_key(display),
        title: None,
        department: Some("Тестовое".into()),
        company: Some("Yealink".into()),
        office: None,
        email: None,
        ip_phone: Some(phone.into()),
        phone_external: None,
        phone_mobile: None,
        manager: None,
        manager_guid: None,
        pager: None,
        usn_changed: None,
        tokens,
    }
}

#[test]
fn external_source_replaces_renames_and_clears() {
    let db = sample_db();
    let replaced = db
        .replace_external_users(
            "Yealink",
            &[
                external_record("ext-1", "ТЕСТ", "310"),
                external_record("ext-2", "Тест 1", "311"),
            ],
        )
        .expect("replace external");
    assert_eq!(replaced, 2);

    // Источник виден в фильтре организаций, записи ищутся по номеру.
    let orgs = db.list_organizations().expect("orgs");
    assert!(orgs.contains(&"Yealink".to_string()));
    let page = db
        .search(SearchParams {
            query: Some("310".into()),
            ..Default::default()
        })
        .expect("search");
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].display_name.as_deref(), Some("ТЕСТ"));

    // Переименование источника (заголовок файла изменён) убирает старый кэш:
    // организация внешней записи совпадает с именем источника, как в бою.
    let mut renamed = external_record("ext-3", "Тест 2", "312");
    renamed.company = Some("Yealink v2".into());
    db.replace_external_users("Yealink v2", &[renamed])
        .expect("replace renamed");
    let orgs = db.list_organizations().expect("orgs");
    assert!(!orgs.contains(&"Yealink".to_string()));
    assert!(orgs.contains(&"Yealink v2".to_string()));
    // Записи AD не задеты: 3 сотрудника + 1 внешняя.
    assert_eq!(db.count().expect("count"), 4);

    // Отключение опции вычищает внешний кэш целиком, мета уходит каскадом.
    let cleared = db.clear_external_users().expect("clear");
    assert_eq!(cleared, 1);
    assert_eq!(db.count().expect("count"), 3);
    let orgs = db.list_organizations().expect("orgs");
    assert!(!orgs.contains(&"Yealink v2".to_string()));
    let metas = db.sync_meta().expect("meta");
    assert!(metas.iter().all(|meta| meta.organization != "Yealink v2"));
}

#[test]
fn source_kind_distinguishes_ad_and_external() {
    let db = sample_db();
    assert_eq!(
        db.source_kind("КМАруда").expect("kind").as_deref(),
        Some("ad")
    );
    assert_eq!(db.source_kind("нет такого").expect("kind"), None);
    db.replace_external_users("Yealink", &[external_record("ext-1", "ТЕСТ", "310")])
        .expect("replace");
    assert_eq!(
        db.source_kind("Yealink").expect("kind").as_deref(),
        Some("external")
    );
}

#[test]
fn external_records_are_excluded_from_duplicate_clusters() {
    let db = sample_db();
    // Полный «двойник» сотрудника AD из внешнего файла: то же имя и телефон.
    let mut twin = external_record("ext-twin", "Иванов Иван Иванович", "5611");
    twin.company = Some("КМАруда".into());
    twin.department = Some("IT отдел".into());
    db.replace_external_users("Yealink", &[twin])
        .expect("replace");

    let preview = db.duplicates_preview().expect("preview");
    assert_eq!(
        preview.groups, 0,
        "внешний файл не должен участвовать в уборке дубликатов: {:?}",
        preview.samples
    );
}

/// Нагрузочный замер поиска: 50k контактов, p50/p95/p99 по типовым запросам
/// и конкурентная нагрузка 1/2/4/8 потоков.
///
/// Запуск вручную (в обычном `cargo test` не выполняется):
///
/// ```text
/// cargo test --manifest-path src-tauri/Cargo.toml search_load_benchmark -- --ignored --nocapture
/// ```
///
/// Размер базы и число итераций можно переопределить:
/// `PB_BENCH_ROWS=100000 PB_BENCH_ITERS=200`.
#[test]
#[ignore = "manual load benchmark"]
fn search_load_benchmark() {
    use std::sync::{Arc, Barrier};
    use std::time::{Duration, Instant};

    use crate::services::tokens::{email_tokens, initials_tokens, phone_tokens};

    const SURNAMES: &[&str] = &[
        "Иванов",
        "Петров",
        "Смирнов",
        "Кузнецов",
        "Соколов",
        "Попов",
        "Лебедев",
        "Козлов",
        "Новиков",
        "Морозов",
    ];
    const NAMES: &[&str] = &[
        "Иван",
        "Пётр",
        "Алексей",
        "Дмитрий",
        "Сергей",
        "Андрей",
        "Михаил",
        "Николай",
    ];
    const DEPARTMENTS: &[&str] = &[
        "Бухгалтерия",
        "IT отдел",
        "Кадры",
        "Продажи",
        "Логистика",
        "Склад",
        "Главный инженер",
    ];
    const TITLES: &[&str] = &[
        "Специалист",
        "Ведущий инженер",
        "Начальник отдела",
        "Менеджер",
        "Бухгалтер",
    ];

    fn load_record(i: usize) -> UserRecord {
        let surname = SURNAMES[i % SURNAMES.len()];
        let name = NAMES[(i / SURNAMES.len()) % NAMES.len()];
        let department = DEPARTMENTS[(i / 7) % DEPARTMENTS.len()];
        let title = TITLES[(i / 11) % TITLES.len()];
        let display_name = format!("{surname} {name} {i:05}");
        // Каждая 25-я учётка — «пустая»: проверяем hide_empty под нагрузкой.
        let blank = i.is_multiple_of(25);
        let email = (!blank).then(|| format!("user{i}@kmaruda.ru"));
        let ip_phone = (!blank).then(|| format!("56{:04}", i % 10_000));
        let phone_external = (!blank).then(|| format!("+7 (495) 123-{:02}-89", i % 100));
        let phone_mobile =
            (!blank).then(|| format!("+7 (9{:02}) 000-00-{:02}", i % 100, (i / 7) % 100));

        let mut tokens = initials_tokens(&display_name);
        tokens.extend(email_tokens(email.as_deref().unwrap_or_default()));
        tokens.extend(phone_tokens(&[
            ip_phone.as_deref(),
            phone_external.as_deref(),
            phone_mobile.as_deref(),
        ]));
        tokens.sort();
        tokens.dedup();

        UserRecord {
            object_guid: format!("guid-{i:08}"),
            sam_account_name: Some(format!("user{i}")),
            first_name: Some(name.into()),
            last_name: Some(surname.into()),
            middle_name: Some("Иванович".into()),
            display_name: display_name.clone(),
            sort_key: display_name.to_lowercase(),
            title: Some(title.into()),
            department: Some(department.into()),
            company: Some("КМАруда".into()),
            office: Some(format!("Каб. {}", 100 + i % 50)),
            email,
            ip_phone,
            phone_external,
            phone_mobile,
            manager: None,
            manager_guid: None,
            pager: Some(format!("tc-{i}")),
            usn_changed: Some(i as i64),
            tokens: tokens.join(" "),
        }
    }

    fn percentile(sorted: &[Duration], p: f64) -> f64 {
        let idx = ((sorted.len() as f64 * p).ceil() as usize)
            .saturating_sub(1)
            .min(sorted.len().saturating_sub(1));
        sorted[idx].as_secs_f64() * 1000.0
    }

    let rows = std::env::var("PB_BENCH_ROWS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(50_000usize)
        .clamp(1_000, 200_000);
    let iters = std::env::var("PB_BENCH_ITERS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100usize)
        .clamp(10, 1_000);

    eprintln!("=== PhoneBook search load test: rows={rows}, iters={iters} ===");
    let records: Vec<UserRecord> = (0..rows).map(load_record).collect();
    let db = Db::open_shared_in_memory().expect("shared in-memory db");
    let seed_start = Instant::now();
    db.replace_org_users("КМАруда", &records).expect("seed");
    eprintln!(
        "seed: {:.2}s ({:.0} rows/s)",
        seed_start.elapsed().as_secs_f64(),
        rows as f64 / seed_start.elapsed().as_secs_f64()
    );

    type Case = (&'static str, fn() -> SearchParams);
    let cases: Vec<Case> = vec![
        ("browse 300", || SearchParams {
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("name prefix", || SearchParams {
            query: Some("Иван".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("substring trigram", || SearchParams {
            query: Some("хгал".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("email exact", || SearchParams {
            query: Some("user12345@kmaruda.ru".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("phone tail 2 digits", || SearchParams {
            query: Some("22-89".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("name + org filter", || SearchParams {
            query: Some("Иван".into()),
            organization: Some("КМАруда".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("name + hide empty", || SearchParams {
            query: Some("Петров".into()),
            limit: Some(300),
            hide_empty: true,
            ..Default::default()
        }),
        ("deep page offset", || SearchParams {
            query: Some("Иван".into()),
            limit: Some(100),
            offset: Some(5_000),
            hide_empty: true,
            ..Default::default()
        }),
    ];

    eprintln!(
        "{:<22} {:>10} {:>10} {:>10} {:>10} {:>8}",
        "case", "p50,ms", "p95,ms", "p99,ms", "avg,ms", "hits"
    );
    for (name, make) in &cases {
        for _ in 0..10 {
            std::hint::black_box(db.search(make()).expect("warmup"));
        }
        let mut latencies = Vec::with_capacity(iters);
        let mut hits = 0u64;
        for _ in 0..iters {
            let start = Instant::now();
            let page = db.search(make()).expect("search");
            latencies.push(start.elapsed());
            hits = page.total;
        }
        latencies.sort();
        let avg = latencies.iter().map(|d| d.as_secs_f64()).sum::<f64>() / latencies.len() as f64
            * 1000.0;
        eprintln!(
            "{:<22} {:>10.2} {:>10.2} {:>10.2} {:>10.2} {:>8}",
            name,
            percentile(&latencies, 0.50),
            percentile(&latencies, 0.95),
            percentile(&latencies, 0.99),
            avg,
            hits
        );
    }

    eprintln!("--- concurrent search (shared SQLite connection) ---");
    eprintln!(
        "{:<8} {:>10} {:>10} {:>10} {:>10}",
        "workers", "qps", "p50,ms", "p95,ms", "p99,ms"
    );
    for workers in [1usize, 2, 4, 8] {
        let barrier = Arc::new(Barrier::new(workers + 1));
        let per_worker = iters;
        let mut handles = Vec::with_capacity(workers);
        for _ in 0..workers {
            let db = db.clone();
            let barrier = barrier.clone();
            handles.push(std::thread::spawn(move || {
                let queries = ["Иван", "хгал", "user12345@kmaruda.ru", "22-89"];
                let mut latencies = Vec::with_capacity(per_worker);
                barrier.wait();
                for i in 0..per_worker {
                    let start = Instant::now();
                    let page = db
                        .search(SearchParams {
                            query: Some(queries[i % queries.len()].into()),
                            limit: Some(100),
                            hide_empty: true,
                            ..Default::default()
                        })
                        .expect("concurrent search");
                    latencies.push(start.elapsed());
                    std::hint::black_box(page.total);
                }
                latencies
            }));
        }
        barrier.wait();
        let start = Instant::now();
        let mut latencies = Vec::with_capacity(workers * per_worker);
        for handle in handles {
            latencies.extend(handle.join().expect("worker"));
        }
        let elapsed = start.elapsed();
        latencies.sort();
        eprintln!(
            "{:<8} {:>10.1} {:>10.2} {:>10.2} {:>10.2}",
            workers,
            (workers * per_worker) as f64 / elapsed.as_secs_f64(),
            percentile(&latencies, 0.50),
            percentile(&latencies, 0.95),
            percentile(&latencies, 0.99)
        );
    }
    eprintln!("=== done ===");
}
