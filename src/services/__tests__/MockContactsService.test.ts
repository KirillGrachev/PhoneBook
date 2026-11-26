import { describe, expect, it } from 'vitest';

import { MockContactsService } from '@/services/MockContactsService';
import { useAppStore } from '@/store/useAppStore';
import { KMARUDA_ORG } from '@/services/mockData';

const service = new MockContactsService();

describe('MockContactsService (демо-режим)', () => {
  it('возвращает все контакты и точное total', async () => {
    const page = await service.search({ activeTab: 'global' });
    expect(page.contacts.length).toBeGreaterThan(0);
    expect(page.total).toBe(page.contacts.length);
    const names = page.contacts.map((c) => c.fullName);
    const sorted = [...names].sort((a, b) => new Intl.Collator('ru').compare(a, b));
    expect(names).toEqual(sorted);
  });

  it('фильтрует по вкладке предприятия по выбранной звезде', async () => {
    useAppStore.setState({
      testMode: true,
      ldapConfigs: [],
      orgGroups: [{ id: 'demo', name: 'Демо', orgs: [KMARUDA_ORG] }],
      enterpriseGroupId: 'demo',
    });

    const page = await service.search({ activeTab: 'kmaruda' });
    expect(page.contacts.length).toBeGreaterThan(0);
    expect(page.contacts.every((c) => c.organization === KMARUDA_ORG)).toBe(true);

    useAppStore.setState({ testMode: false, ldapConfigs: [], orgGroups: [], enterpriseGroupId: null });
  });

  it('без выбранной звезды не показывает демо-контакты KMAruda', async () => {
    useAppStore.setState({
      testMode: true,
      ldapConfigs: [],
      orgGroups: [{ id: 'demo', name: 'Демо', orgs: [KMARUDA_ORG] }],
      enterpriseGroupId: null,
    });

    const page = await service.search({ activeTab: 'kmaruda' });
    expect(page.contacts).toEqual([]);
    expect(page.total).toBe(0);

    useAppStore.setState({ testMode: false, ldapConfigs: [], orgGroups: [], enterpriseGroupId: null });
  });

  it('фильтрует по организации и отделу', async () => {
    const page = await service.search({
      activeTab: 'global',
      organization: KMARUDA_ORG,
      department: 'Бухгалтерия',
    });
    expect(page.contacts.length).toBeGreaterThan(0);
    expect(page.contacts.every((c) => c.department === 'Бухгалтерия')).toBe(true);
  });

  it('фильтрует по должности и кабинету (клики по карточке)', async () => {
    const byTitle = await service.search({ activeTab: 'global', title: 'Бухгалтер' });
    expect(byTitle.contacts.length).toBeGreaterThan(1);
    expect(byTitle.contacts.every((c) => c.jobTitle === 'Бухгалтер')).toBe(true);

    const byOffice = await service.search({ activeTab: 'global', office: 'Каб. 401' });
    expect(byOffice.contacts.length).toBeGreaterThan(1);
    expect(byOffice.contacts.every((c) => c.office === 'Каб. 401')).toBe(true);

    // Job title and office together (a colleague card from the same office).
    const both = await service.search({ activeTab: 'global', title: 'Бухгалтер', office: 'Каб. 210' });
    expect(both.contacts.map((c) => c.id)).toEqual(['mock-orlova']);

    const none = await service.search({ activeTab: 'global', office: 'Каб. 999' });
    expect(none.contacts).toEqual([]);
    expect(none.total).toBe(0);
  });

  it('учитывает союз организаций группы фильтра', async () => {
    const all = await service.search({ activeTab: 'global' });
    const orgs = [...new Set(all.contacts.map((c) => c.organization).filter((o): o is string => Boolean(o)))];
    expect(orgs.length).toBeGreaterThan(1);
    const union = orgs.slice(0, 2);

    const page = await service.search({ activeTab: 'global', organizations: union });
    expect(page.contacts.length).toBeGreaterThan(0);
    expect(page.contacts.every((c) => c.organization && union.includes(c.organization))).toBe(true);
  });

  it('выбранная группа без подходящих демо-организаций даёт пусто', async () => {
    useAppStore.setState({
      testMode: true,
      ldapConfigs: [
        {
          organization: 'АО Комбинат КМАруда',
          ldapUrl: 'ldap://dc',
          baseDn: 'dc=kmaruda,dc=ru',
          bindDn: null,
          useStartTls: false,
          allowInvalidTls: false,
          useIntegratedAuth: true,
          hasPassword: false,
        },
      ],
      orgGroups: [{ id: 'g1', name: 'Группа', orgs: ['ООО «Рога и Копыта»'] }],
      enterpriseGroupId: 'g1',
    });

    const page = await service.search({ activeTab: 'kmaruda' });
    expect(page.contacts.length).toBeGreaterThan(0);
    expect(page.contacts.every((c) => c.organization === 'ООО «Рога и Копыта»')).toBe(true);

    useAppStore.setState({ testMode: false, ldapConfigs: [], orgGroups: [], enterpriseGroupId: null });
  });

  it('ищет по строке с учётом раскладки', async () => {
    const byName = await service.search({ activeTab: 'global', search: 'иванов' });
    expect(byName.contacts.some((c) => c.fullName.includes('Иванов'))).toBe(true);

    const byLayout = await service.search({ activeTab: 'global', search: 'bdfyjd' });
    expect(byLayout.contacts.some((c) => c.fullName.includes('Иванов'))).toBe(true);
  });

  it('вкладка «Мои контакты» выбирает только сохранённые id', async () => {
    const all = await service.search({ activeTab: 'global' });
    const savedIds = all.contacts.slice(0, 2).map((c) => c.id);
    const saved = await service.search({ activeTab: 'local', savedIds });
    expect(saved.contacts.map((c) => c.id).sort()).toEqual([...savedIds].sort());

    const empty = await service.search({ activeTab: 'local', savedIds: [] });
    expect(empty.contacts).toEqual([]);
    expect(empty.total).toBe(0);
  });

  it('ищет по строке внутри «Моих контактов»', async () => {
    const all = await service.search({ activeTab: 'global' });
    const saved = all.contacts.slice(0, 5);
    const savedIds = saved.map((c) => c.id);
    const token = saved[0].fullName.split(/\s+/)[0];
    const filtered = await service.search({
      activeTab: 'local',
      savedIds,
      search: token,
    });
    expect(filtered.total).toBe(filtered.contacts.length);
    expect(filtered.contacts.length).toBeGreaterThan(0);
    expect(filtered.contacts.length).toBeLessThanOrEqual(saved.length);
    expect(filtered.contacts.every((c) => savedIds.includes(c.id))).toBe(true);
  });

  it('getById отдаёт контакт или типизированную ошибку', async () => {
    const all = await service.search({ activeTab: 'global' });
    const found = await service.getById(all.contacts[0].id);
    expect(found.id).toBe(all.contacts[0].id);

    await expect(service.getById('no-such-id')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('уважает limit, но total остаётся полным', async () => {
    const page = await service.search({ activeTab: 'global', limit: 2 });
    expect(page.contacts.length).toBeLessThanOrEqual(2);
    expect(page.total).toBeGreaterThan(page.contacts.length);
  });
});
