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
fn substring_match_works_via_like_fallback() {
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

    db.set_sync_error("КМАруда", "сервер недоступен")
        .expect("set error");
    let meta = db.sync_meta().expect("meta");
    let kma = meta.iter().find(|m| m.organization == "КМАруда").unwrap();
    assert_eq!(kma.last_error.as_deref(), Some("сервер недоступен"));
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
fn like_specials_are_escaped() {
    let db = sample_db();
    // «%» не должен матчить всё подряд.
    let found = db
        .search(SearchParams {
            query: Some("%".into()),
            ..Default::default()
        })
        .expect("search")
        .items;
    assert!(found.is_empty());
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
fn stale_sync_prunes_unused_lookups() {
    let db = sample_db();
    // Петров переведён в «Кадры» без кабинета, Иванов уволен:
    // «IT отдел» и «Бухгалтерия» больше никому не нужны.
    let mut moved = record("g2", "КМАруда", "Петров Пётр Петрович", "Кадры", "22");
    moved.office = None;
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
    let image = encryption::serialize(&db.lock()).expect("serialize");

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
