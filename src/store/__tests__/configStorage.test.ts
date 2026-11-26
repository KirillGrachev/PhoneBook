import { describe, expect, it, vi } from 'vitest';

const GROUPS = [{ id: 'g1', name: 'Группа', orgs: ['АО Комбинат'] }];

vi.mock('@/api/directory', () => ({
  configApi: {
    load: vi.fn(async () => ({
      theme: 'system',
      language: 'ru',
      globalMode: false,
      testMode: false,
      animationsEnabled: true,
      syncIntervalHours: 24,
      hideEmptyContacts: true,
      emailOverrides: {},
      ldapConfigs: [],
      savedContactIds: [],
      orgGroups: GROUPS,
      enterpriseGroupId: 'g1',
    })),
    save: vi.fn(async () => ({})),
  },
}));

import { configStorage } from '@/store/configStorage';

describe('configStorage: гидрация', () => {
  it('возвращает группы организаций и отметку вкладки предприятия', async () => {
    const raw = await configStorage.getItem('phonebook-storage');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { state: Record<string, unknown> };
    // Regression: without these keys hydration overwrote groups with the default on
    // every restart, despite being stored in config.json.
    expect(parsed.state.orgGroups).toEqual(GROUPS);
    expect(parsed.state.enterpriseGroupId).toBe('g1');
  });
});
