/**
 * Файл обмена конфигурацией: перенос настроек между ПК.
 *
 * Семантика синхронизирована с бэкендом (`services/config/share.rs`):
 * маркер `format` и `version` проверяются до применения, секреты LDAP
 * не переносятся (флаг `hasPassword` из файла игнорируется — пароли
 * живут в системном хранилище каждой машины).
 *
 * В desktop-сборке валидацию выполняет Rust-команда `parse_config_file`;
 * функции этого модуля — чистая точка сборки патча стора и fallback-разбор
 * для браузерного демо-режима (покрыты unit-тестами).
 */
import type { AppConfigDto, LanguageCode, LdapOrgConfigDto, OrgGroupDto, ThemeName } from '@/api/contracts';

/** Маркер формата файла обмена (зеркалит `CONFIG_SHARE_FORMAT` бэкенда). */
export const CONFIG_FILE_FORMAT = 'kmaruda-phonebook/config';
/** Текущая версия формата файла обмена (зеркалит `CONFIG_SHARE_VERSION`). */
export const CONFIG_FILE_VERSION = 1;

/** Ошибка формата файла обмена конфигурацией (для локализованных тостов). */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/**
 * Патч стора из конфигурации файла обмена: все переносимые поля.
 * Применяется `useAppStore.setState`, персист уходит обычным save_config.
 */
export interface ConfigPatch {
  theme: ThemeName;
  language: LanguageCode;
  globalMode: boolean;
  testMode: boolean;
  animationsEnabled: boolean;
  syncIntervalHours: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  ldapConfigs: LdapOrgConfigDto[];
  savedContactIds: string[];
  orgGroups: OrgGroupDto[];
  enterpriseGroupId: string | null;
  externalPhonebookPath: string | null;
  externalPhonebookEnabled: boolean;
}

/** Собрать патч стора из проверенного DTO конфигурации. */
export function buildConfigPatch(config: AppConfigDto): ConfigPatch {
  return {
    theme: config.theme as ThemeName,
    language: config.language as LanguageCode,
    globalMode: config.globalMode,
    testMode: config.testMode,
    animationsEnabled: config.animationsEnabled,
    syncIntervalHours: config.syncIntervalHours,
    hideEmptyContacts: config.hideEmptyContacts,
    emailOverrides: config.emailOverrides,
    // Флаг «пароль сохранён» с чужой машины ложён на этой: секреты не переносятся.
    ldapConfigs: config.ldapConfigs.map((org) => ({ ...org, hasPassword: false })),
    savedContactIds: config.savedContactIds,
    orgGroups: config.orgGroups,
    enterpriseGroupId: config.enterpriseGroupId,
    externalPhonebookPath: config.externalPhonebookPath,
    externalPhonebookEnabled: config.externalPhonebookEnabled,
  };
}

/**
 * Fallback-разбор файла обмена для браузерного демо-режима: структура
 * проверяется здесь, в desktop-сборке вместо этой функции используется
 * валидация на бэкенде (`parse_config_file`).
 */
export function parseConfigFileContent(content: string, errorMessage: string): AppConfigDto {
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    throw new ConfigFileError(errorMessage);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigFileError(errorMessage);
  }
  const file = raw as Record<string, unknown>;
  if (file.format !== CONFIG_FILE_FORMAT || typeof file.version !== 'number' || file.version > CONFIG_FILE_VERSION) {
    throw new ConfigFileError(errorMessage);
  }
  const config = file.config;
  if (typeof config !== 'object' || config === null) {
    throw new ConfigFileError(errorMessage);
  }
  return normalizeConfigDto(config as Record<string, unknown>);
}

/** DTO конфигурации из произвольного JSON с дефолтами по каждому полю. */
function normalizeConfigDto(raw: Record<string, unknown>): AppConfigDto {
  const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
  const theme = (value: unknown): ThemeName =>
    value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  const language = (value: unknown): LanguageCode => (value === 'en' ? 'en' : 'ru');
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const num = (value: unknown, fallback: number): number => (typeof value === 'number' ? value : fallback);
  const strList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const ldapConfigs: LdapOrgConfigDto[] = Array.isArray(raw.ldapConfigs)
    ? raw.ldapConfigs
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((org) => ({
          organization: str(org.organization, ''),
          ldapUrl: str(org.ldapUrl, ''),
          baseDn: str(org.baseDn, ''),
          bindDn: typeof org.bindDn === 'string' ? org.bindDn : null,
          useStartTls: bool(org.useStartTls, false),
          allowInvalidTls: bool(org.allowInvalidTls, false),
          useIntegratedAuth: bool(org.useIntegratedAuth, true),
          hasPassword: false,
        }))
    : [];

  const orgGroups: OrgGroupDto[] = Array.isArray(raw.orgGroups)
    ? raw.orgGroups
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((group) => ({
          id: str(group.id, ''),
          name: str(group.name, ''),
          orgs: strList(group.orgs),
        }))
    : [];

  return {
    theme: theme(raw.theme),
    language: language(raw.language),
    globalMode: bool(raw.globalMode, false),
    savedContactIds: strList(raw.savedContactIds),
    ldapConfigs,
    testMode: bool(raw.testMode, false),
    animationsEnabled: bool(raw.animationsEnabled, true),
    syncIntervalHours: num(raw.syncIntervalHours, 24),
    hideEmptyContacts: bool(raw.hideEmptyContacts, true),
    emailOverrides:
      typeof raw.emailOverrides === 'object' && raw.emailOverrides !== null
        ? Object.fromEntries(
            Object.entries(raw.emailOverrides as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {},
    orgGroups,
    enterpriseGroupId: typeof raw.enterpriseGroupId === 'string' ? raw.enterpriseGroupId : null,
    externalPhonebookPath: typeof raw.externalPhonebookPath === 'string' ? raw.externalPhonebookPath : null,
    externalPhonebookEnabled: bool(raw.externalPhonebookEnabled, false),
    version: null,
  };
}

/**
 * Содержимое файла обмена для браузерного экспорта: desktop-сборку пишет
 * бэкенд, в демо-режиме файл собирает фронтенд из текущего состояния стора.
 */
export function renderConfigFile(patch: ConfigPatch): string {
  return JSON.stringify(
    {
      format: CONFIG_FILE_FORMAT,
      version: CONFIG_FILE_VERSION,
      exportedAt: Math.floor(Date.now() / 1000),
      config: { ...patch },
    },
    null,
    2,
  );
}
