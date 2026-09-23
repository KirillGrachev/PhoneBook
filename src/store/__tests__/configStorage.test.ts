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
    // Регрессия: без этих ключей гидрация затирала группы дефолтом при
    // каждом перезапуске, несмотря на то что в config.json они лежали.
    expect(parsed.state.orgGroups).toEqual(GROUPS);
    expect(parsed.state.enterpriseGroupId).toBe('g1');
  });
});
