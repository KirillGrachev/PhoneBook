import type { LdapOrgConfigDto, OrgGroupDto, OrgGroupsFileDto } from '@/api/contracts';

/**
 * Organization groups (combined filters): pure resolution functions.
 *
 * Semantics (synchronized with the backend, `services/db/read.rs`):
 * * the "KMAruda" tab of the non-global version considers the union of organizations
 *   the group starred in settings; with no group selected the result is empty,
 *   without substituting the first AD connection;
 * * in the global version a group replaces the organizations it absorbs in the filter
 *   ({@link collectGroupedOrgs}).
 */

/** Group by identifier: `null` if the identifier is empty or the group is deleted. */
export function findOrgGroup(groups: OrgGroupDto[], id: string | null | undefined): OrgGroupDto | null {
  if (!id) {
    return null;
  }
  return groups.find((group) => group.id === id) ?? null;
}

/** Settings that participate in directory filtering. */
export interface DirectoryScope {
  ldapConfigs: LdapOrgConfigDto[];
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/**
 * In test mode real AD connections are hidden, but local groups
 * remain available — otherwise the starred group selection cannot be checked on demo data.
 */
export function resolveDirectoryScope(
  testMode: boolean,
  ldapConfigs: LdapOrgConfigDto[],
  groups: OrgGroupDto[],
  enterpriseGroupId: string | null,
): DirectoryScope {
  if (testMode) {
    return { ldapConfigs: [], groups, enterpriseGroupId };
  }
  return { ldapConfigs, groups, enterpriseGroupId };
}

/**
 * Organizations of the "KMAruda" tab: the union of organizations of the group
 * with a star. With no group selected an empty array is returned: the tab
 * must not substitute the first AD connection and show the whole holding.
 */
export function resolveEnterpriseOrgs(
  _ldapConfigs: LdapOrgConfigDto[],
  groups: OrgGroupDto[],
  enterpriseGroupId: string | null,
): string[] {
  return groupOrgNames(findOrgGroup(groups, enterpriseGroupId));
}

/** Group organizations without empty values; a `null` group → an empty list. */
function groupOrgNames(group: OrgGroupDto | null): string[] {
  if (!group) {
    return [];
  }
  return group.orgs.map((org) => org.trim()).filter((org) => org !== '');
}

/** The name of the combined enterprise filter for search placeholders. */
export function resolveEnterpriseName(
  _ldapConfigs: LdapOrgConfigDto[],
  groups: OrgGroupDto[],
  enterpriseGroupId: string | null,
): string | null {
  const group = findOrgGroup(groups, enterpriseGroupId);
  if (group && groupOrgNames(group).length > 0) {
    return group.name.trim() || null;
  }
  return null;
}

/** Organizations absorbed by groups: in the global version a group replaces them. */
export function collectGroupedOrgs(groups: OrgGroupDto[]): Set<string> {
  const grouped = new Set<string>();
  for (const group of groups) {
    for (const org of group.orgs) {
      const name = org.trim();
      if (name) {
        grouped.add(name);
      }
    }
  }
  return grouped;
}

/** New group identifier: the environment UUID with a fallback for environments without `crypto.randomUUID`. */
export function newOrgGroupId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `org-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ============================= group exchange file ============================= */

/** The exchange file format marker (mirrors Rust `SHARE_FORMAT`). */
export const ORG_GROUPS_SHARE_FORMAT = 'kmaruda-phonebook/org-groups';
/** Exchange file format version (mirrors Rust `SHARE_VERSION`). */
export const ORG_GROUPS_SHARE_VERSION = 1;
/** The full configuration file marker (mirrors Rust `CONFIG_SHARE_FORMAT`). */
export const CONFIG_SHARE_FORMAT = 'kmaruda-phonebook/config';
/** Format version of the full configuration file. */
export const CONFIG_SHARE_VERSION = 1;
/** The file name when exporting in the browser (demo mode). */
export const ORG_GROUPS_SHARE_FILE_NAME = 'kmaruda-org-groups.json';

/** An exchange file format error: the text is ready to show to the user. */
export class OrgGroupsFileError extends Error {}

/** Organization name to a canonical form: trimming + collapsing repeated spaces. */
export function normalizeOrgName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeGroup(group: OrgGroupDto): OrgGroupDto | null {
  const name = normalizeOrgName(group.name ?? '');
  if (!name || !group.id?.trim()) {
    return null;
  }
  const orgs = [...new Set((group.orgs ?? []).map((org) => normalizeOrgName(org)).filter((org) => org !== ''))];
  return { id: group.id.trim(), name, orgs };
}

/**
 * Validate an arbitrary parsed JSON as a group exchange file.
 * In the desktop the first line of validation is Rust (`parse_org_groups_file`);
 * here — protection of demo mode and defence-in-depth.
 */
export function validateOrgGroupsFile(value: unknown): OrgGroupsFileDto {
  if (!value || typeof value !== 'object') {
    throw new OrgGroupsFileError('Файл групп организаций не является корректным JSON-объектом');
  }
  const candidate = value as Partial<OrgGroupsFileDto> & {
    config?: { orgGroups?: unknown; enterpriseGroupId?: unknown };
  };

  let sourceGroups: unknown[];
  let sourceEnterpriseGroupId: unknown;
  let sourceExportedAt: unknown;

  if (candidate.format === CONFIG_SHARE_FORMAT) {
    if (typeof candidate.version !== 'number' || candidate.version > CONFIG_SHARE_VERSION) {
      throw new OrgGroupsFileError(
        'Файл конфигурации создан более новой версией приложения (версия формата новее поддерживаемой)',
      );
    }
    if (!candidate.config || !Array.isArray(candidate.config.orgGroups)) {
      throw new OrgGroupsFileError('В файле конфигурации нет списка групп организаций');
    }
    sourceGroups = candidate.config.orgGroups;
    sourceEnterpriseGroupId = candidate.config.enterpriseGroupId;
  } else {
    if (candidate.format !== ORG_GROUPS_SHARE_FORMAT) {
      throw new OrgGroupsFileError(
        `Это не файл групп организаций KMAruda PhoneBook (неизвестный формат «${String(candidate.format)}»)`,
      );
    }
    if (typeof candidate.version !== 'number' || candidate.version > ORG_GROUPS_SHARE_VERSION) {
      throw new OrgGroupsFileError(
        'Файл групп организаций создан более новой версией приложения (версия формата новее поддерживаемой)',
      );
    }
    if (!Array.isArray(candidate.groups)) {
      throw new OrgGroupsFileError('В файле групп организаций нет списка групп');
    }
    sourceGroups = candidate.groups;
    sourceEnterpriseGroupId = candidate.enterpriseGroupId;
    sourceExportedAt = candidate.exportedAt;
  }

  const groups: OrgGroupDto[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const raw of sourceGroups) {
    const group = normalizeGroup(raw as OrgGroupDto);
    if (!group) {
      throw new OrgGroupsFileError('В файле групп организаций есть группа без названия или идентификатора');
    }
    if (ids.has(group.id)) {
      throw new OrgGroupsFileError(`В файле групп организаций дублируется идентификатор группы «${group.name}»`);
    }
    if (names.has(group.name.toLowerCase())) {
      throw new OrgGroupsFileError(`В файле групп организаций дублируется название «${group.name}»`);
    }
    ids.add(group.id);
    names.add(group.name.toLowerCase());
    groups.push(group);
  }

  const enterpriseGroupId =
    typeof sourceEnterpriseGroupId === 'string' && sourceEnterpriseGroupId.trim() !== ''
      ? sourceEnterpriseGroupId
      : null;
  return {
    format: ORG_GROUPS_SHARE_FORMAT,
    version: ORG_GROUPS_SHARE_VERSION,
    exportedAt: typeof sourceExportedAt === 'number' ? sourceExportedAt : null,
    groups,
    enterpriseGroupId,
  };
}

/** Build an exchange file from the current state (export). */
export function buildOrgGroupsFile(groups: OrgGroupDto[], enterpriseGroupId: string | null): OrgGroupsFileDto {
  return {
    format: ORG_GROUPS_SHARE_FORMAT,
    version: ORG_GROUPS_SHARE_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    groups: groups.map((group) => normalizeGroup(group)).filter((group): group is OrgGroupDto => group !== null),
    enterpriseGroupId,
  };
}

/** The result of merging imported groups with local ones. */
export interface MergedOrgGroups {
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/**
 * Merge the exchange file with local groups.
 *
 * Matching: first by identifier, then by name (case
 * does not matter). A matched group is replaced by the imported composition, but
 * keeps the local identifier (local groups may reference it via the enterprise tab
 * mark); new groups are added. The "KMAruda" tab mark from the file
 * is applied only if a group with this identifier is present in the result.
 */
export function mergeOrgGroups(
  local: OrgGroupDto[],
  file: OrgGroupsFileDto,
  currentEnterpriseGroupId: string | null,
): MergedOrgGroups {
  const groups = local.map((group) => ({ ...group, orgs: [...group.orgs] }));
  // Where the group identifier from the file moved: to itself or to the local id of a match.
  const importedToResultId = new Map<string, string>();

  for (const raw of file.groups) {
    const imported = normalizeGroup(raw);
    if (!imported) {
      continue;
    }
    const index = groups.findIndex(
      (group) => group.id === imported.id || group.name.trim().toLowerCase() === imported.name.toLowerCase(),
    );
    if (index >= 0) {
      const localId = groups[index].id;
      groups[index] = { ...imported, id: localId };
      importedToResultId.set(imported.id, localId);
    } else {
      groups.push(imported);
      importedToResultId.set(imported.id, imported.id);
    }
  }

  let enterpriseGroupId = currentEnterpriseGroupId;
  const filePin = file.enterpriseGroupId ? importedToResultId.get(file.enterpriseGroupId) : undefined;
  if (filePin && groups.some((group) => group.id === filePin)) {
    enterpriseGroupId = filePin;
  }
  if (enterpriseGroupId && !groups.some((group) => group.id === enterpriseGroupId)) {
    enterpriseGroupId = null;
  }
  return { groups, enterpriseGroupId };
}
