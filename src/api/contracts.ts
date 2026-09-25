/**
 * DTO-контракты Rust-бэкенда.
 *
 * Типы зеркалят serde-структуры (`rename_all = "camelCase"`) из
 * `src-tauri/src/services/*`. Любое изменение контракта на бэкенде
 * должно сопровождаться правкой здесь — это единственная точка правды.
 */

/** Тема оформления (бэкенд нормализует к одному из трёх значений). */
export type ThemeName = 'light' | 'dark' | 'system';

/** Язык интерфейса (бэкенд нормализует к ru/en). */
export type LanguageCode = 'ru' | 'en';

export interface EmployeeDto {
  objectGuid: string;
  /** Организация-источник синхронизации (из настроек AD). */
  sourceOrg: string;
  samAccountName: string | null;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  displayName: string | null;
  title: string | null;
  department: string | null;
  company: string | null;
  office: string | null;
  email: string | null;
  ipPhone: string | null;
  phoneExternal: string | null;
  phoneMobile: string | null;
  manager: string | null;
  /** GUID руководителя для клика по карточке (если руководитель в выборке). */
  managerGuid?: string | null;
  /** TrueConf ID сотрудника: значение AD-атрибута `pager`. */
  pager: string | null;
  usnChanged: number | null;
  updatedAt: number | null;
}

/** DTO конфигурации подключения организации (camelCase-контракт бэкенда). */
export interface LdapOrgConfigDto {
  organization: string;
  ldapUrl: string;
  baseDn: string;
  bindDn: string | null;
  useStartTls: boolean;
  allowInvalidTls: boolean;
  useIntegratedAuth: boolean;
  /** Пароль хранится в системном keyring; флаг говорит «секрет сохранён». */
  hasPassword: boolean;
}

/** Организация в запросе на сохранение конфигурации (без секрета). */
export interface LdapOrgInput {
  organization: string;
  ldapUrl: string;
  baseDn: string;
  bindDn?: string | null;
  useStartTls: boolean;
  allowInvalidTls: boolean;
  useIntegratedAuth: boolean;
}

/** Группа организаций: объединённые фильтры с одним названием (camelCase-контракт бэкенда). */
export interface OrgGroupDto {
  id: string;
  name: string;
  orgs: string[];
}

/**
 * Файл обмена группами организаций: перенос настроек между машинами.
 * Зеркалит Rust-структуру `OrgGroupsShareFile` (`services/config/share.rs`):
 * маркер `format` и `version` проверяются на бэкенде до применения.
 */
export interface OrgGroupsFileDto {
  format: string;
  version: number;
  exportedAt: number | null;
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/** DTO корневого конфига приложения на стороне бэкенда. */
export interface AppConfigDto {
  theme: string;
  language: string;
  globalMode: boolean;
  savedContactIds: string[];
  ldapConfigs: LdapOrgConfigDto[];
  testMode: boolean;
  animationsEnabled: boolean;
  syncIntervalHours: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  orgGroups: OrgGroupDto[];
  /** Группа для вкладки «КМАруда» (не глобальная версия). */
  enterpriseGroupId: string | null;
  /** Путь к внешнему телефонному файлу (Yealink IPPhoneBook); null — не подключён. */
  externalPhonebookPath: string | null;
  /** Загружать внешний телефонный файл в справочник. */
  externalPhonebookEnabled: boolean;
  version?: string | null;
}

/** Запрос сохранения конфига; секрет передаётся отдельным каналом. */
export interface SaveConfigRequest {
  theme: string;
  language: string;
  globalMode: boolean;
  savedContactIds: string[];
  ldapConfigs: LdapOrgInput[];
  testMode: boolean;
  animationsEnabled: boolean;
  syncIntervalHours: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  orgGroups: OrgGroupDto[];
  /** Группа для вкладки «КМАруда»; `null` — наследуемое поведение. */
  enterpriseGroupId: string | null;
  externalPhonebookPath: string | null;
  externalPhonebookEnabled: boolean;
}

/**
 * Итог загрузки внешнего телефонного файла (тег `state` в serde-энумерации
 * [`ExternalRefresh`]): `loaded` — файл в кэше, `cleared` — кэш очищен
 * (записей больше нет), `disabled` — опция выключена.
 */
export interface ExternalRefreshDto {
  state: 'disabled' | 'cleared' | 'loaded';
  cleared?: number;
  organization?: string | null;
  count?: number;
}

/** Результат диагностики подключения к каталогу. */
export interface ConnectionTestDto {
  bindMs: number;
  serverDnsName: string | null;
  /** defaultNamingContext из rootDSE — подсказка для Base DN. */
  defaultNamingContext: string | null;
  sampleNames: string[];
  sampleIsTruncated: boolean;
}

/** Фазы live-события синхронизации. */
export type SyncEventState = 'started' | 'progress' | 'finished' | 'error' | 'runFinished';

/** Событие канала `directory-sync` (serde tag = "state"). */
export interface SyncEventDto {
  state: SyncEventState;
  organization?: string;
  fetched?: number;
  count?: number;
  durationMs?: number;
  code?: string;
  message?: string;
}

/** Состояние прогона синхронизации одной организации. */
export interface OrgSyncStateDto {
  organization: string;
  running: boolean;
  lastSyncAt: number | null;
  lastCount: number | null;
  lastError: string | null;
}

/** Совокупный статус синхронизации: персистентная мета + live-фазы. */
export interface SyncStatusDto {
  running: boolean;
  organizations: OrgSyncStateDto[];
}

/** Страница выдачи: контакты + точное общее число совпадений. */
export interface SearchPageDto {
  items: EmployeeDto[];
  total: number;
}

/** Параметры поиска и фильтров (контракт команды `search_contacts`). */
export interface SearchParamsDto {
  query?: string | null;
  organization?: string | null;
  /** Союз организаций (группа фильтров): вкладка предприятия / группа глобальной версии. */
  organizations?: string[] | null;
  /** Фильтр по организации-источнику синхронизации (вкладка «Предприятие»). */
  sourceOrg?: string | null;
  department?: string | null;
  /** Фильтр по должности (клик по должности в карточке). */
  title?: string | null;
  /** Фильтр по кабинету (клик по кабинету в карточке). */
  office?: string | null;
  ids?: string[] | null;
  limit?: number | null;
  /** Смещение порции выдачи (порционная загрузка списком). */
  offset?: number | null;
  hideEmpty?: boolean | null;
}

/** Превью дубликатов учётных записей в кэше (camelCase-контракт бэкенда). */
export interface DuplicatesPreviewDto {
  groups: number;
  removable: number;
  samples: string[];
}

/** Данные контакта для генерации vCard на бэкенде. */
export interface VCardInputDto {
  id?: string | null;
  fullName: string;
  organization?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  mobilePhone?: string | null;
  ipPhone?: string | null;
  phoneExternal?: string | null;
  /** Режим предприятия (вкладка «КМАруда» не глобальной версии). */
  preferExternalPhone?: boolean;
  email?: string | null;
}

/** Стабильные коды ошибок бэкенда (зеркало `AppError::code()`). */
export const ERROR_CODES = [
  'CONFIG_ERROR',
  'VALIDATION',
  'LDAP_UNREACHABLE',
  'LDAP_TIMEOUT',
  'LDAP_AUTH',
  'LDAP_TLS',
  'LDAP_PROTOCOL',
  'DB_ERROR',
  'NOT_FOUND',
  'INTERNAL',
  'NOT_RUNNING_IN_DESKTOP',
] as const;

/** Код ошибки IPC — элемент [`ERROR_CODES`]. */
export type ErrorCode = (typeof ERROR_CODES)[number];
