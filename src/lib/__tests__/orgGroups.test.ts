import { describe, expect, it } from 'vitest';

import type { LdapOrgConfigDto, OrgGroupDto, OrgGroupsFileDto } from '@/api/contracts';
import {
  buildOrgGroupsFile,
  collectGroupedOrgs,
  findOrgGroup,
  mergeOrgGroups,
  newOrgGroupId,
  OrgGroupsFileError,
  ORG_GROUPS_SHARE_FORMAT,
  ORG_GROUPS_SHARE_VERSION,
  resolveEnterpriseName,
  resolveEnterpriseOrgs,
  validateOrgGroupsFile,
} from '@/lib/orgGroups';

const ldapConfig = (organization: string): LdapOrgConfigDto => ({
  organization,
  ldapUrl: 'ldap://dc.kmaruda.ru',
  baseDn: 'DC=kmaruda,DC=ru',
  bindDn: null,
  useStartTls: false,
  allowInvalidTls: false,
  useIntegratedAuth: true,
  hasPassword: false,
});

const group = (id: string, name: string, orgs: string[]): OrgGroupDto => ({ id, name, orgs });

describe('orgGroups', () => {
  const groups = [
    group('g1', 'КМАруда', ['АО "Комбинат КМАруда"', 'ООО "Рудник Северный"']),
    group('g2', 'Стройка', ['АО Глобал Строй']),
  ];
  const ldap = [ldapConfig('АО Комбинат КМаруда')];

  it('findOrgGroup возвращает группу только по живому идентификатору', () => {
    expect(findOrgGroup(groups, 'g1')?.name).toBe('КМАруда');
    expect(findOrgGroup(groups, 'g3')).toBeNull();
    expect(findOrgGroup(groups, null)).toBeNull();
  });

  it('вкладка предприятия берёт союз организаций отмеченной группы', () => {
    expect(resolveEnterpriseOrgs(ldap, groups, 'g1')).toEqual(['АО "Комбинат КМАруда"', 'ООО "Рудник Северный"']);
    expect(resolveEnterpriseName(ldap, groups, 'g1')).toBe('КМАруда');
  });

  it('без группы вкладка предприятия наследует первую AD-организацию', () => {
    expect(resolveEnterpriseOrgs(ldap, groups, null)).toEqual(['АО Комбинат КМаруда']);
    expect(resolveEnterpriseName(ldap, groups, null)).toBe('АО Комбинат КМаруда');
    expect(resolveEnterpriseOrgs([], groups, null)).toEqual([]);
    expect(resolveEnterpriseName([], groups, null)).toBeNull();
  });

  it('битая ссылка на удалённую группу деградирует в базовое поведение', () => {
    expect(resolveEnterpriseOrgs(ldap, groups, 'deleted')).toEqual(['АО Комбинат КМаруда']);
  });

  it('пустая отмеченная группа не снимает фильтр предприятия', () => {
    const withEmpty = [...groups, group('g3', 'Черновик', [])];
    expect(resolveEnterpriseOrgs(ldap, withEmpty, 'g3')).toEqual(['АО Комбинат КМаруда']);
    expect(resolveEnterpriseName(ldap, withEmpty, 'g3')).toBe('АО Комбинат КМаруда');
  });

  it('collectGroupedOrgs собирает поглощённые организациями группы', () => {
    const grouped = collectGroupedOrgs(groups);
    expect(grouped.has('АО "Комбинат КМАруда"')).toBe(true);
    expect(grouped.has('АО Глобал Строй')).toBe(true);
    expect(grouped.has('АО Комбинат КМаруда')).toBe(false);
  });

  it('newOrgGroupId выдаёт уникальные идентификаторы', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newOrgGroupId()));
    expect(ids.size).toBe(50);
  });
});

describe('файл обмена группами организаций', () => {
  const group = (id: string, name: string, orgs: string[]): OrgGroupDto => ({ id, name, orgs });

  const file = (groups: OrgGroupDto[], enterpriseGroupId: string | null = null): OrgGroupsFileDto => ({
    format: ORG_GROUPS_SHARE_FORMAT,
    version: ORG_GROUPS_SHARE_VERSION,
    exportedAt: 1700000000,
    groups,
    enterpriseGroupId,
  });

  it('buildOrgGroupsFile нормализует группы и ставит маркер формата', () => {
    const built = buildOrgGroupsFile([group('g1', ' КМАруда ', ['  КМАруда ', 'КМАруда', ''])], 'g1');
    expect(built.format).toBe(ORG_GROUPS_SHARE_FORMAT);
    expect(built.version).toBe(ORG_GROUPS_SHARE_VERSION);
    expect(built.groups[0]).toEqual({ id: 'g1', name: 'КМАруда', orgs: ['КМАруда'] });
    expect(built.enterpriseGroupId).toBe('g1');
  });

  it('validateOrgGroupsFile отклоняет чужой JSON и новую версию', () => {
    expect(() => validateOrgGroupsFile({ format: 'other', version: 1, groups: [] })).toThrow(OrgGroupsFileError);
    expect(() => validateOrgGroupsFile({ format: ORG_GROUPS_SHARE_FORMAT, version: 99, groups: [] })).toThrow(
      OrgGroupsFileError,
    );
    expect(() => validateOrgGroupsFile('строка')).toThrow(OrgGroupsFileError);
  });

  it('mergeOrgGroups добавляет новые группы и не трогает локальные', () => {
    const merged = mergeOrgGroups(
      [group('local1', 'Локальная', ['А'])],
      file([group('imp1', 'Привозная', ['Б', 'В'])]),
      null,
    );
    expect(merged.groups).toHaveLength(2);
    expect(merged.groups[1]).toEqual(group('imp1', 'Привозная', ['Б', 'В']));
    expect(merged.enterpriseGroupId).toBeNull();
  });

  it('mergeOrgGroups заменяет совпавшую по названию группу, сохраняя локальный id', () => {
    const merged = mergeOrgGroups(
      [group('local1', 'КМАруда', ['Старая'])],
      file([group('imp1', 'кмаруда', ['Новая', 'Новая2'])], 'imp1'),
      null,
    );
    expect(merged.groups).toHaveLength(1);
    // локальный id сохранён для локальных отметок
    expect(merged.groups[0].id).toBe('local1');
    expect(merged.groups[0].orgs).toEqual(['Новая', 'Новая2']);
    // отметка из файла переехала на локальный id
    expect(merged.enterpriseGroupId).toBe('local1');
  });

  it('mergeOrgGroups совпадение по id заменяет состав', () => {
    const merged = mergeOrgGroups([group('g1', 'КМАруда', ['А'])], file([group('g1', 'КМАруда', ['Б'])]), 'g1');
    expect(merged.groups[0].orgs).toEqual(['Б']);
    expect(merged.enterpriseGroupId).toBe('g1');
  });

  it('mergeOrgGroups игнорирует отметку файла, если группы нет в результате', () => {
    const merged = mergeOrgGroups(
      [group('local1', 'Локальная', ['А'])],
      file([group('imp1', 'Привозная', ['Б'])], 'missing-id'),
      'local1',
    );
    // текущая отметка сохранена
    expect(merged.enterpriseGroupId).toBe('local1');
  });

  it('mergeOrgGroups сбрасывает отметку, если локальная группа исчезла', () => {
    const merged = mergeOrgGroups([group('local1', 'Локальная', ['А'])], file([]), 'gone-id');
    expect(merged.enterpriseGroupId).toBeNull();
  });
});
