/**
 * Typed wrappers over the backend commands.
 *
 * Grouped by domain: contacts, configuration, synchronization,
 * system, vCard. Command and argument names correspond to
 * `#[tauri::command]` functions in `src-tauri/src/commands/*`.
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

/** Directory commands: search, card, organizations, counter. */
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
        requestId: params.requestId ?? null,
      },
    }),

  getById: (id: string): Promise<EmployeeDto> => invokeCommand<EmployeeDto>('get_contact', { id }),

  /** Avatar of a contact as a `data:` URL, or `null` when there is no photo. */
  getPhoto: (id: string): Promise<string | null> => invokeCommand<string | null>('get_contact_photo', { id }),

  listOrganizations: (): Promise<string[]> => invokeCommand<string[]>('list_organizations'),

  count: (): Promise<number> => invokeCommand<number>('count_contacts'),

  /** Duplicate preview: clusters, the number of removable records, and their names. */
  previewDuplicates: (): Promise<DuplicatesPreviewDto> =>
    invokeCommand<DuplicatesPreviewDto>('preview_duplicate_contacts'),

  /** Duplicate cleanup: returns the number of removed records. */
  deduplicate: (): Promise<number> => invokeCommand<number>('deduplicate_contacts'),
};

/** Configuration: read/save, secret, connection test. */
export const configApi = {
  load: (): Promise<AppConfigDto> => invokeCommand<AppConfigDto>('load_config'),

  save: (config: SaveConfigRequest): Promise<AppConfigDto> => invokeCommand<AppConfigDto>('save_config', { config }),

  /**
   * A separate channel for the secret: `null` — remove the saved password.
   * The password never passes through the store/configuration.
   */
  setPassword: (organization: string, password: string | null): Promise<void> =>
    invokeCommand<void>('set_ldap_password', { organization, password }),

  /** Exporting organization groups to an exchange file; returns the written file path. */
  exportOrgGroupsFile: (): Promise<string> => invokeCommand<string>('export_org_groups_file'),

  /** Validate the content of a group exchange file; returns a normalized DTO. */
  parseOrgGroupsFile: (content: string): Promise<OrgGroupsFileDto> =>
    invokeCommand<OrgGroupsFileDto>('parse_org_groups_file', { content }),

  /** Re-read the external phone file using the saved configuration. */
  refreshExternalPhonebook: (): Promise<ExternalRefreshDto> =>
    invokeCommand<ExternalRefreshDto>('refresh_external_phonebook'),

  /** Native multi-file XML picker; an empty array means the dialog was closed. */
  pickExternalPhonebookFiles: (): Promise<string[]> => invokeCommand<string[]>('pick_external_phonebook_files'),

  /** Exporting the configuration to an exchange file; returns the written file path. */
  exportConfigFile: (): Promise<string> => invokeCommand<string>('export_config_file'),

  /** Validate the content of a config exchange file; returns the config DTO. */
  parseConfigFile: (content: string): Promise<AppConfigDto> =>
    invokeCommand<AppConfigDto>('parse_config_file', { content }),

  testConnection: (
    org: LdapOrgInput,
    passwordOverride?: string | null,
    connectTimeoutSecs = 15,
    operationTimeoutSecs = 30,
  ): Promise<ConnectionTestDto> =>
    invokeCommand<ConnectionTestDto>('test_ldap_connection', {
      org,
      passwordOverride: passwordOverride ?? null,
      connectTimeoutSecs,
      operationTimeoutSecs,
    }),
};

/** Synchronization: starting a run and the aggregate status. */
export const syncApi = {
  /** Returns `false` if synchronization is already running. */
  start: (force = false): Promise<boolean> => invokeCommand<boolean>('start_sync', { force }),

  status: (): Promise<SyncStatusDto> => invokeCommand<SyncStatusDto>('get_sync_status'),
};

/** System commands: tray, external links, devtools. */
export const systemApi = {
  updateTrayMenu: (openText: string, quitText: string): Promise<void> =>
    invokeCommand<void>('update_tray_menu', { openText, quitText }),

  openExternal: (url: string): Promise<void> => invokeCommand<void>('open_external', { url }),

  openDevtools: (): Promise<void> => invokeCommand<void>('open_devtools'),
};

/** Generating a contact vCard on the backend. */
export const vcardApi = {
  generate: (contact: VCardInputDto): Promise<string> => invokeCommand<string>('generate_vcard', { contact }),
};
