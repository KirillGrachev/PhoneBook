/**
 * Config exchange file: transferring settings between PCs.
 *
 * Semantics synchronized with the backend (`services/config/share.rs`):
 * the `format` marker and `version` are checked before applying, LDAP secrets
 * are not transferred (the `hasPassword` flag from the file is ignored — passwords
 * live in the system store of each machine).
 *
 * In the desktop build validation is performed by the Rust command `parse_config_file`;
 * the functions of this module are a pure assembly point for the store patch and fallback parsing
 * for the browser demo mode (covered by unit tests).
 */
import type { AppConfigDto, LanguageCode, LdapOrgConfigDto, OrgGroupDto, ThemeName } from '@/api/contracts';

/** The exchange file format marker (mirrors the backend `CONFIG_SHARE_FORMAT`). */
export const CONFIG_FILE_FORMAT = 'kmaruda-phonebook/config';
/** The current exchange file format version (mirrors `CONFIG_SHARE_VERSION`). */
export const CONFIG_FILE_VERSION = 1;

/** A config exchange file format error (for localized toasts). */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/**
 * A store patch from the exchange file config: all transferable fields.
 * `useAppStore.setState` is applied, persistence goes through the usual save_config.
 */
export interface ConfigPatch {
  theme: ThemeName;
  language: LanguageCode;
  globalMode: boolean;
  testMode: boolean;
  animationsEnabled: boolean;
  showAvatars: boolean;
  syncIntervalHours: number;
  ldapConnectTimeoutSecs: number;
  ldapOperationTimeoutSecs: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  ldapConfigs: LdapOrgConfigDto[];
  savedContactIds: string[];
  orgGroups: OrgGroupDto[];
  enterpriseGroupId: string | null;
  externalPhonebookPath: string | null;
  externalPhonebookPaths: string[];
  externalPhonebookEnabled: boolean;
  externalPhonebookIntervals: Record<string, number>;
  externalHideAdDuplicates: boolean;
}

/** Build a store patch from a validated configuration DTO. */
export function buildConfigPatch(config: AppConfigDto): ConfigPatch {
  return {
    theme: config.theme as ThemeName,
    language: config.language as LanguageCode,
    globalMode: config.globalMode,
    testMode: config.testMode,
    animationsEnabled: config.animationsEnabled,
    showAvatars: config.showAvatars ?? true,
    syncIntervalHours: config.syncIntervalHours,
    ldapConnectTimeoutSecs: config.ldapConnectTimeoutSecs,
    ldapOperationTimeoutSecs: config.ldapOperationTimeoutSecs,
    hideEmptyContacts: config.hideEmptyContacts,
    emailOverrides: config.emailOverrides,
    // The "password saved" flag from another machine is false here: secrets are not transferred.
    ldapConfigs: config.ldapConfigs.map((org) => ({ ...org, hasPassword: false })),
    savedContactIds: config.savedContactIds,
    orgGroups: config.orgGroups,
    enterpriseGroupId: config.enterpriseGroupId,
    externalPhonebookPath: config.externalPhonebookPaths[0] ?? config.externalPhonebookPath,
    externalPhonebookPaths:
      config.externalPhonebookPaths.length > 0
        ? config.externalPhonebookPaths
        : config.externalPhonebookPath
          ? [config.externalPhonebookPath]
          : [],
    externalPhonebookEnabled: config.externalPhonebookEnabled,
    externalPhonebookIntervals: config.externalPhonebookIntervals ?? {},
    externalHideAdDuplicates: config.externalHideAdDuplicates ?? true,
  };
}

/**
 * Fallback parsing of the exchange file for the browser demo mode: the structure
 * is checked here; in the desktop build this function is replaced by
 * validation on the backend (`parse_config_file`).
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

/** Configuration DTO from arbitrary JSON with defaults for each field. */
function normalizeConfigDto(raw: Record<string, unknown>): AppConfigDto {
  const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
  const theme = (value: unknown): ThemeName =>
    value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  const language = (value: unknown): LanguageCode => (value === 'ru' ? 'ru' : 'en');
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
    showAvatars: bool(raw.showAvatars, true),
    syncIntervalHours: num(raw.syncIntervalHours, 24),
    ldapConnectTimeoutSecs: num(raw.ldapConnectTimeoutSecs, 15),
    ldapOperationTimeoutSecs: num(raw.ldapOperationTimeoutSecs, 30),
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
    managed: bool(raw.managed, false),
    managedProfile: typeof raw.managedProfile === 'string' ? raw.managedProfile : null,
    managedRevision: typeof raw.managedRevision === 'number' ? raw.managedRevision : null,
    externalPhonebookPaths: Array.isArray(raw.externalPhonebookPaths)
      ? raw.externalPhonebookPaths.filter((path): path is string => typeof path === 'string')
      : typeof raw.externalPhonebookPath === 'string'
        ? [raw.externalPhonebookPath]
        : [],
    externalPhonebookEnabled: bool(raw.externalPhonebookEnabled, false),
    externalHideAdDuplicates: bool(raw.externalHideAdDuplicates, true),
    externalPhonebookIntervals:
      typeof raw.externalPhonebookIntervals === 'object' && raw.externalPhonebookIntervals !== null
        ? Object.fromEntries(
            Object.entries(raw.externalPhonebookIntervals as Record<string, unknown>).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
            ),
          )
        : {},
    version: null,
  };
}

/**
 * Exchange file content for browser export: the desktop build is written by
 * the backend; in demo mode the frontend assembles the file from the current store state.
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
