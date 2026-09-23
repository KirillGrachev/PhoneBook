import { beforeEach, describe, expect, it } from 'vitest';

import { useAppStore } from '@/store/useAppStore';

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({ savedContactIds: [], activeTab: 'global', selectedId: null, search: '', selectedOrg: null });
  });

  it('toggleSavedContact добавляет и удаляет id без дубликатов', () => {
    const { toggleSavedContact } = useAppStore.getState();

    toggleSavedContact('g1');
    expect(useAppStore.getState().savedContactIds).toEqual(['g1']);

    toggleSavedContact('g2');
    toggleSavedContact('g1');
    expect(useAppStore.getState().savedContactIds).toEqual(['g2']);

    toggleSavedContact('g2');
    expect(useAppStore.getState().savedContactIds).toEqual([]);

    // Повторное добавление того же id не создаёт дубликат.
    toggleSavedContact('g3');
    toggleSavedContact('g3');
    expect(useAppStore.getState().savedContactIds).toEqual([]);
    toggleSavedContact('g3');
    expect(useAppStore.getState().savedContactIds).toEqual(['g3']);
  });

  it('saveOrgGroup создаёт и обновляет группы, removeOrgGroup снимает ссылку вкладки', () => {
    useAppStore.setState({ orgGroups: [], enterpriseGroupId: null });
    const { saveOrgGroup, removeOrgGroup, setEnterpriseGroupId } = useAppStore.getState();

    saveOrgGroup({ id: 'g1', name: 'КМАруда', orgs: ['АО Комбинат'] });
    saveOrgGroup({ id: 'g2', name: 'Стройка', orgs: ['АО Глобал Строй'] });
    expect(useAppStore.getState().orgGroups.map((group) => group.id)).toEqual(['g1', 'g2']);

    saveOrgGroup({ id: 'g1', name: 'КМАруда', orgs: ['АО Комбинат', 'ООО Рудник'] });
    expect(useAppStore.getState().orgGroups).toHaveLength(2);
    expect(useAppStore.getState().orgGroups[0].orgs).toEqual(['АО Комбинат', 'ООО Рудник']);

    setEnterpriseGroupId('g1');
    removeOrgGroup('g1');
    const state = useAppStore.getState();
    expect(state.orgGroups.map((group) => group.id)).toEqual(['g2']);
    // Ссылка вкладки предприятия не должна указывать на удалённую группу.
    expect(state.enterpriseGroupId).toBeNull();
    useAppStore.setState({ orgGroups: [], enterpriseGroupId: null });
  });

  it('partialize включает группы и исключает эфемерное состояние UI', () => {
    const state = useAppStore.getState();
    const persisted = useAppStore.persist.getOptions().partialize?.(state) as Record<string, unknown>;

    expect(Object.keys(persisted)).toContain('theme');
    expect(Object.keys(persisted)).toContain('savedContactIds');
    expect(Object.keys(persisted)).toContain('ldapConfigs');
    expect(Object.keys(persisted)).toContain('orgGroups');
    expect(Object.keys(persisted)).toContain('enterpriseGroupId');
    expect(Object.keys(persisted)).not.toContain('search');
    expect(Object.keys(persisted)).not.toContain('selectedId');
    expect(Object.keys(persisted)).not.toContain('activeTab');
    expect(Object.keys(persisted)).not.toContain('selectedGroupId');
    expect(Object.keys(persisted)).not.toContain('selectedOrg');
  });

  it('setTheme/setLanguage обновляют только свои поля', () => {
    useAppStore.getState().setTheme('dark');
    useAppStore.getState().setLanguage('en');
    const state = useAppStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.language).toBe('en');
    expect(state.animationsEnabled).toBe(true);
  });
});
