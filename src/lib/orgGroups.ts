import type { LdapOrgConfigDto, OrgGroupDto, OrgGroupsFileDto } from '@/api/contracts';

/**
 * Группы организаций (объединённые фильтры): чистые функции разрешения.
 *
 * Семантика (синхронизирована с бэкендом, `services/db/read.rs`):
 * * вкладка «КМАруда» не глобальной версии учитывает союз организаций
 *   группы, отмеченной в настройках; без выбранной группы — пустая выдача,
 *   без подстановки первого AD-подключения;
 * * в глобальной версии группа заменяет в фильтре поглощённые организации
 *   ({@link collectGroupedOrgs}).
 */

/** Группа по идентификатору: `null`, если идентификатор пустой или группа удалена. */
export function findOrgGroup(groups: OrgGroupDto[], id: string | null | undefined): OrgGroupDto | null {
  if (!id) {
    return null;
  }
  return groups.find((group) => group.id === id) ?? null;
}

/** Настройки, которые участвуют в фильтрации справочника. */
export interface DirectoryScope {
  ldapConfigs: LdapOrgConfigDto[];
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/**
 * В тестовом режиме справочник полностью демонстрационный: реальные
 * AD-подключения, группы и предприятие не должны попадать в фильтры.
 */
export function resolveDirectoryScope(
  testMode: boolean,
  ldapConfigs: LdapOrgConfigDto[],
  groups: OrgGroupDto[],
  enterpriseGroupId: string | null,
): DirectoryScope {
  if (testMode) {
    return { ldapConfigs: [], groups: [], enterpriseGroupId: null };
  }
  return { ldapConfigs, groups, enterpriseGroupId };
}

/**
 * Организации вкладки «КМАруда»: союз организаций группы, отмеченной
 * звездой. Без выбранной группы возвращается пустой массив: вкладка не
 * должна подставлять первое AD-подключение и показывать весь холдинг.
 */
export function resolveEnterpriseOrgs(
  _ldapConfigs: LdapOrgConfigDto[],
  groups: OrgGroupDto[],
  enterpriseGroupId: string | null,
): string[] {
  return groupOrgNames(findOrgGroup(groups, enterpriseGroupId));
}

/** Организации группы без пустых значений; `null`-группа → пустой список. */
function groupOrgNames(group: OrgGroupDto | null): string[] {
  if (!group) {
    return [];
  }
  return group.orgs.map((org) => org.trim()).filter((org) => org !== '');
}

/** Имя объединённого фильтра предприятия для плейсхолдеров поиска. */
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

/** Организации, поглощённые группами: в глобальной версии их заменяет группа. */
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

/** Идентификатор новой группы: UUID среды с фолбэком для сред без `crypto.randomUUID`. */
export function newOrgGroupId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `org-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ============================= файл обмена группами ============================= */

/** Маркер формата файла обмена (зеркалит Rust `SHARE_FORMAT`). */
export const ORG_GROUPS_SHARE_FORMAT = 'kmaruda-phonebook/org-groups';
/** Версия формата файла обмена (зеркалит Rust `SHARE_VERSION`). */
export const ORG_GROUPS_SHARE_VERSION = 1;
/** Маркер полного файла конфигурации (зеркалит Rust `CONFIG_SHARE_FORMAT`). */
export const CONFIG_SHARE_FORMAT = 'kmaruda-phonebook/config';
/** Версия формата полного файла конфигурации. */
export const CONFIG_SHARE_VERSION = 1;
/** Имя файла при экспорте в браузере (демо-режим). */
export const ORG_GROUPS_SHARE_FILE_NAME = 'kmaruda-org-groups.json';

/** Ошибка формата файла обмена: текст готов к показу пользователю. */
export class OrgGroupsFileError extends Error {}

/** Название организации к единому виду: обрезка + схлопывание повторов пробелов. */
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
 * Проверить произвольный разобранный JSON как файл обмена группами.
 * В десктопе первой линией валидации является Rust (`parse_org_groups_file`);
 * здесь — защита демо-режима и defence-in-depth.
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

/** Собрать файл обмена из текущего состояния (экспорт). */
export function buildOrgGroupsFile(groups: OrgGroupDto[], enterpriseGroupId: string | null): OrgGroupsFileDto {
  return {
    format: ORG_GROUPS_SHARE_FORMAT,
    version: ORG_GROUPS_SHARE_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    groups: groups.map((group) => normalizeGroup(group)).filter((group): group is OrgGroupDto => group !== null),
    enterpriseGroupId,
  };
}

/** Результат слияния импортированных групп с локальными. */
export interface MergedOrgGroups {
  groups: OrgGroupDto[];
  enterpriseGroupId: string | null;
}

/**
 * Слить файл обмена с локальными группами.
 *
 * Соответствие: сначала по идентификатору, затем по названию (регистр
 * не важен). Совпавшая группа заменяется импортированным составом, но
 * сохраняет локальный идентификатор (на него могут ссылаться локальные
 * отметки); новые группы добавляются. Отметка вкладки «КМАруда» из файла
 * применяется, только если группа с этим идентификатором есть в результате.
 */
export function mergeOrgGroups(
  local: OrgGroupDto[],
  file: OrgGroupsFileDto,
  currentEnterpriseGroupId: string | null,
): MergedOrgGroups {
  const groups = local.map((group) => ({ ...group, orgs: [...group.orgs] }));
  // Куда переехал идентификатор группы из файла: сам себе или локальный id совпавшей.
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
