/**
 * Типизированные обёртки над командами бэкенда.
 *
 * Группировка по доменам: контакты, конфигурация, синхронизация,
 * система, vCard. Имена команд и аргументов соответствуют
 * `#[tauri::command]`-функциям в `src-tauri/src/commands/*`.
 */
import { invokeCommand } from './backend';
import type {
  AppConfigDto,
  SearchPageDto,
  ConnectionTestDto,
  DuplicatesPreviewDto,
  EmployeeDto,
  ExternalRefreshDto,
  LdapOrgInput,
  OrgGroupsFileDto,
  SaveConfigRequest,
  SearchParamsDto,
  SyncStatusDto,
  VCardInputDto,
} from './contracts';

/** Команды справочника: поиск, карточка, организации, счётчик. */
export const contactsApi = {
  search: (params: SearchParamsDto): Promise<SearchPageDto> =>
    invokeCommand<SearchPageDto>('search_contacts', {
      params: {
        query: params.query ?? null,
        organization: params.organization ?? null,
        organizations: params.organizations ?? null,
        sourceOrg: params.sourceOrg ?? null,
        department: params.department ?? null,
        title: params.title ?? null,
        office: params.office ?? null,
        ids: params.ids ?? null,
        limit: params.limit ?? null,
        offset: params.offset ?? null,
        hideEmpty: params.hideEmpty ?? true,
      },
    }),

  getById: (id: string): Promise<EmployeeDto> => invokeCommand<EmployeeDto>('get_contact', { id }),

  listOrganizations: (): Promise<string[]> => invokeCommand<string[]>('list_organizations'),

  count: (): Promise<number> => invokeCommand<number>('count_contacts'),

  /** Превью дубликатов учёток: кластеры, число убираемых записей, примеры. */
  previewDuplicates: (): Promise<DuplicatesPreviewDto> =>
    invokeCommand<DuplicatesPreviewDto>('preview_duplicate_contacts'),

  /** Уборка дубликатов: возвращает число удалённых записей. */
  deduplicate: (): Promise<number> => invokeCommand<number>('deduplicate_contacts'),
};

/** Конфигурация: чтение/сохранение, секрет, проверка подключения. */
export const configApi = {
  load: (): Promise<AppConfigDto> => invokeCommand<AppConfigDto>('load_config'),

  save: (config: SaveConfigRequest): Promise<AppConfigDto> => invokeCommand<AppConfigDto>('save_config', { config }),

  /**
   * Отдельный канал для секрета: `null` — удалить сохранённый пароль.
   * Пароль никогда не проходит через store/конфигурацию.
   */
  setPassword: (organization: string, password: string | null): Promise<void> =>
    invokeCommand<void>('set_ldap_password', { organization, password }),

  /** Экспорт групп организаций в файл обмена; возвращает путь записанного файла. */
  exportOrgGroupsFile: (): Promise<string> => invokeCommand<string>('export_org_groups_file'),

  /** Валидировать содержимое файла обмена группами; возвращает нормализованный DTO. */
  parseOrgGroupsFile: (content: string): Promise<OrgGroupsFileDto> =>
    invokeCommand<OrgGroupsFileDto>('parse_org_groups_file', { content }),

  /** Перечитать внешний телефонный файл по сохранённой конфигурации. */
  refreshExternalPhonebook: (): Promise<ExternalRefreshDto> =>
    invokeCommand<ExternalRefreshDto>('refresh_external_phonebook'),

  /** Нативный диалог выбора XML-файла; `null` — диалог закрыт. */
  pickExternalPhonebookFile: (): Promise<string | null> => invokeCommand<string | null>('pick_external_phonebook_file'),

  /** Экспорт конфигурации в файл обмена; возвращает путь записанного файла. */
  exportConfigFile: (): Promise<string> => invokeCommand<string>('export_config_file'),

  /** Валидировать содержимое файла обмена конфигурацией; возвращает DTO конфига. */
  parseConfigFile: (content: string): Promise<AppConfigDto> =>
    invokeCommand<AppConfigDto>('parse_config_file', { content }),

  testConnection: (org: LdapOrgInput, passwordOverride?: string | null): Promise<ConnectionTestDto> =>
    invokeCommand<ConnectionTestDto>('test_ldap_connection', {
      org,
      passwordOverride: passwordOverride ?? null,
    }),
};

/** Синхронизация: запуск прогона и совокупный статус. */
export const syncApi = {
  /** Возвращает `false`, если синхронизация уже идёт. */
  start: (force = false): Promise<boolean> => invokeCommand<boolean>('start_sync', { force }),

  status: (): Promise<SyncStatusDto> => invokeCommand<SyncStatusDto>('get_sync_status'),
};

/** Системные команды: трей, внешние ссылки, devtools. */
export const systemApi = {
  updateTrayMenu: (openText: string, quitText: string): Promise<void> =>
    invokeCommand<void>('update_tray_menu', { openText, quitText }),

  openExternal: (url: string): Promise<void> => invokeCommand<void>('open_external', { url }),

  openDevtools: (): Promise<void> => invokeCommand<void>('open_devtools'),
};

/** Генерация vCard контакта на бэкенде. */
export const vcardApi = {
  generate: (contact: VCardInputDto): Promise<string> => invokeCommand<string>('generate_vcard', { contact }),
};
