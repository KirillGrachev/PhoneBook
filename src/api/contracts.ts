/**
 * DTO contracts of the Rust backend.
 *
 * The types mirror the serde structures (`rename_all = "camelCase"`) from
 * `src-tauri/src/services/*`. Any contract change on the backend
 * must be accompanied by an edit here — this is the single source of truth.
 */

/** The appearance theme (the backend normalizes to one of three values). */
export type ThemeName = 'light' | 'dark' | 'system';

/** The interface language (the backend normalizes to ru/en). */
export type LanguageCode = 'ru' | 'en';

export interface EmployeeDto {
  objectGuid: string;
  /** The synchronization source organization (from AD settings). */
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
  /** Manager GUID for clicking the card (if the manager is in the sample). */
  managerGuid?: string | null;
  /** Employee TrueConf ID: the value of the AD `pager` attribute. */
  pager: string | null;
  usnChanged: number | null;
  updatedAt: number | null;
}

/** DTO of an organization connection config (the backend camelCase contract). */
export interface LdapOrgConfigDto {
  organization: string;
  ldapUrl: string;
  baseDn: string;
  bindDn: string | null;
  useStartTls: boolean;
  allowInvalidTls: boolean;
  useIntegratedAuth: boolean;
  /** The password is stored in the system keyring; the flag says "the secret is saved". */
  hasPassword: boolean;
}

/** An organization in a config save request (without the secret). */
export interface LdapOrgInput {
  organization: string;
  ldapUrl: string;
  baseDn: string;
  bindDn?: string | null;
  useStartTls: boolean;
  allowInvalidTls: boolean;
  useIntegratedAuth: boolean;
}

/** Organization group: combined filters under one name (the backend camelCase contract). */
export interface OrgGroupDto {
  id: string;
  name: string;
  orgs: string[];
}

/**
 * Organization group exchange file: transferring settings between machines.
 * Mirrors the Rust structure `OrgGroupsShareFile` (`services/config/share.rs`):
 * the `format` marker and `version` are checked on the backend before applying.
 */
export interface OrgGroupsFileDto {
  format: string;
  version: number;
  exportedAt: number | null;
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/** DTO of the root app config on the backend side. */
export interface AppConfigDto {
  theme: string;
  language: string;
  globalMode: boolean;
  savedContactIds: string[];
  ldapConfigs: LdapOrgConfigDto[];
  testMode: boolean;
  animationsEnabled: boolean;
  /** Show contact photos as avatars; when false, letter initials are used. */
  showAvatars: boolean;
  syncIntervalHours: number;
  ldapConnectTimeoutSecs: number;
  ldapOperationTimeoutSecs: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  orgGroups: OrgGroupDto[];
  /** The group for the "KMAruda" tab (non-global version). */
  enterpriseGroupId: string | null;
  /** Legacy single path, kept for config compatibility. */
  externalPhonebookPath: string | null;
  /** External Yealink XML files, each imported as a separate source. */
  externalPhonebookPaths: string[];
  /** Load external phone book files into the directory. */
  externalPhonebookEnabled: boolean;
  /** Per-file automatic refresh interval in hours; absent/0 means manual. */
  externalPhonebookIntervals: Record<string, number>;
  /** Hide Yealink entries that duplicate an AD employee. */
  externalHideAdDuplicates: boolean;
  version?: string | null;
  /** True when administrative settings come from an embedded managed profile. */
  managed: boolean;
  managedProfile: string | null;
  managedRevision: number | null;
}

/** A config save request; the secret is passed through a separate channel. */
export interface SaveConfigRequest {
  theme: string;
  language: string;
  globalMode: boolean;
  savedContactIds: string[];
  ldapConfigs: LdapOrgInput[];
  testMode: boolean;
  animationsEnabled: boolean;
  showAvatars: boolean;
  syncIntervalHours: number;
  ldapConnectTimeoutSecs: number;
  ldapOperationTimeoutSecs: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  orgGroups: OrgGroupDto[];
  /** The group for the "KMAruda" tab; `null` — inherited behavior. */
  enterpriseGroupId: string | null;
  externalPhonebookPath: string | null;
  externalPhonebookPaths: string[];
  externalPhonebookEnabled: boolean;
  externalPhonebookIntervals: Record<string, number>;
  externalHideAdDuplicates: boolean;
}

/**
 * The result of loading an external phone file (the `state` tag in the serde enumeration
 * [`ExternalRefresh`]): `loaded` — the file is cached, `cleared` — the cache is cleared
 * (no more records), `disabled` — the option is turned off.
 */
export interface ExternalSourceDto {
  organization: string;
  count: number;
}

export interface ExternalRefreshDto {
  state: 'disabled' | 'cleared' | 'loaded' | 'cached';
  cleared?: number;
  count?: number;
  sources?: ExternalSourceDto[];
}

/** The result of diagnosing a directory connection (generated from Rust). */
export type { ConnectionTestDto } from './contracts.generated';

/** The phases of a live synchronization event. */
export type SyncEventState = 'started' | 'progress' | 'finished' | 'error' | 'runFinished';

/** An event of the `directory-sync` channel (serde tag = "state"). */
export interface SyncEventDto {
  state: SyncEventState;
  organization?: string;
  fetched?: number;
  count?: number;
  durationMs?: number;
  code?: string;
  message?: string;
}

/** The synchronization run state of a single organization. */
export interface OrgSyncStateDto {
  organization: string;
  running: boolean;
  lastSyncAt: number | null;
  lastCount: number | null;
  lastError: string | null;
}

/** Aggregate synchronization status: persistent meta + live phases. */
export interface SyncStatusDto {
  running: boolean;
  organizations: OrgSyncStateDto[];
}

/** A result page: contacts + the exact total number of matches. */
export interface SearchPageDto {
  items: EmployeeDto[];
  total: number;
}

/** Search and filter parameters (the `search_contacts` command contract). */
export interface SearchParamsDto {
  query?: string | null;
  organization?: string | null;
  /** The union of organizations (a filter group): the enterprise tab / a global-version group. */
  organizations?: string[] | null;
  /** A filter by the synchronization source organization (the "Enterprise" tab). */
  sourceOrg?: string | null;
  department?: string | null;
  /** A job title filter (clicking a title in the card). */
  title?: string | null;
  /** An office filter (clicking an office in the card). */
  office?: string | null;
  ids?: string[] | null;
  limit?: number | null;
  /** The result batch offset (paginated list loading). */
  offset?: number | null;
  hideEmpty?: boolean | null;
  /** Monotonic request number: the backend discards stale ones. */
  requestId?: number | null;
}

/** A preview of duplicate accounts in the cache (the backend camelCase contract). */
export interface DuplicatesPreviewDto {
  groups: number;
  removable: number;
  /** Names of the first records that will actually be deleted. */
  removableNames: string[];
}

/** Contact data for generating a vCard on the backend. */
export interface VCardInputDto {
  id?: string | null;
  fullName: string;
  organization?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  mobilePhone?: string | null;
  ipPhone?: string | null;
  phoneExternal?: string | null;
  /** Enterprise mode (the "KMAruda" tab of the non-global version). */
  preferExternalPhone?: boolean;
  email?: string | null;
}

/** Stable backend error codes (a mirror of `AppError::code()`). */
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

/** IPC error code — an element of [`ERROR_CODES`]. */
export type ErrorCode = (typeof ERROR_CODES)[number];
