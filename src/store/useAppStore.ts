import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isTauri } from '@/api/backend';
import type { LdapOrgConfigDto, OrgGroupDto } from '@/api/contracts';
import type { TabType } from '@/types';

import { configStorage } from './configStorage';

/** Тема оформления: светлая / тёмная / системная. */
import type { LanguageCode, ThemeName } from '@/api/contracts';

export type { LanguageCode, ThemeName };
/** Язык интерфейса. */

/** Персистируемые настройки (в десктопе живут в config.json + keyring). */
interface SettingsSlice {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  globalMode: boolean;
  setGlobalMode: (value: boolean) => void;
  testMode: boolean;
  setTestMode: (value: boolean) => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (value: boolean) => void;
  syncIntervalHours: number;
  setSyncIntervalHours: (hours: number) => void;
  hideEmptyContacts: boolean;
  setHideEmptyContacts: (value: boolean) => void;
  emailOverrides: Record<string, string>;
  setEmailOverride: (contactId: string, email: string) => void;
  ldapConfigs: LdapOrgConfigDto[];
  setLdapConfigs: (configs: LdapOrgConfigDto[]) => void;
  /** Именованные группы организаций (объединённые фильтры). */
  orgGroups: OrgGroupDto[];
  /** Создаёт или обновляет группу (по идентификатору). */
  saveOrgGroup: (group: OrgGroupDto) => void;
  removeOrgGroup: (id: string) => void;
  /** Полная замена набора групп (импорт файла обмена); персист — обычный. */
  setOrgGroups: (groups: OrgGroupDto[]) => void;
  /** Группа для вкладки «КМАруда» (не глобальная версия). */
  enterpriseGroupId: string | null;
  /** Путь к внешнему телефонному файлу (Yealink IPPhoneBook); null — не подключён. */
  externalPhonebookPath: string | null;
  setExternalPhonebookPath: (path: string | null) => void;
  /** Загружать внешний телефонный файл в справочник. */
  externalPhonebookEnabled: boolean;
  setExternalPhonebookEnabled: (enabled: boolean) => void;
  setEnterpriseGroupId: (id: string | null) => void;
  savedContactIds: string[];
  toggleSavedContact: (id: string) => void;
}

/** Эфемерное состояние UI — не персистируется. */
interface UiSlice {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  search: string;
  setSearch: (search: string) => void;
  selectedOrg: string | null;
  setSelectedOrg: (org: string | null) => void;
  /** Выбранная группа фильтра по организации (глобальная версия). */
  selectedGroupId: string | null;
  setSelectedGroupId: (id: string | null) => void;
}

/** Тип корневого стора: срез настроек + срез UI. */
export type AppStore = SettingsSlice & UiSlice;

const createSettingsSlice: StateCreator<AppStore, [['zustand/persist', unknown]], [], SettingsSlice> = (set) => ({
  theme: 'system',
  setTheme: (theme) => set({ theme }),
  language: 'ru',
  setLanguage: (language) => set({ language }),
  globalMode: false,
  setGlobalMode: (globalMode) => set({ globalMode }),
  testMode: false,
  setTestMode: (testMode) => set({ testMode }),
  animationsEnabled: true,
  setAnimationsEnabled: (animationsEnabled) => set({ animationsEnabled }),
  syncIntervalHours: 24,
  setSyncIntervalHours: (syncIntervalHours) => set({ syncIntervalHours }),
  hideEmptyContacts: true,
  setHideEmptyContacts: (hideEmptyContacts) => set({ hideEmptyContacts }),
  emailOverrides: {},
  setEmailOverride: (contactId, email) =>
    set((state) => ({ emailOverrides: { ...state.emailOverrides, [contactId]: email } })),
  ldapConfigs: [],
  setLdapConfigs: (ldapConfigs) => set({ ldapConfigs }),
  orgGroups: [],
  saveOrgGroup: (group) =>
    set((state) => {
      const exists = state.orgGroups.some((item) => item.id === group.id);
      return {
        orgGroups: exists
          ? state.orgGroups.map((item) => (item.id === group.id ? group : item))
          : [...state.orgGroups, group],
      };
    }),
  setOrgGroups: (orgGroups) => set({ orgGroups }),
  removeOrgGroup: (id) =>
    set((state) => ({
      orgGroups: state.orgGroups.filter((group) => group.id !== id),
      // Ссылка вкладки предприятия не должна указывать на удалённую группу.
      enterpriseGroupId: state.enterpriseGroupId === id ? null : state.enterpriseGroupId,
    })),
  enterpriseGroupId: null,
  setEnterpriseGroupId: (enterpriseGroupId) => set({ enterpriseGroupId }),
  externalPhonebookPath: null,
  setExternalPhonebookPath: (externalPhonebookPath) => set({ externalPhonebookPath }),
  externalPhonebookEnabled: false,
  setExternalPhonebookEnabled: (externalPhonebookEnabled) => set({ externalPhonebookEnabled }),
  savedContactIds: [],
  toggleSavedContact: (id) =>
    set((state) => {
      const ids = new Set(state.savedContactIds);
      if (ids.has(id)) {
        ids.delete(id);
      } else {
        ids.add(id);
      }
      return { savedContactIds: [...ids] };
    }),
});

const createUiSlice: StateCreator<AppStore, [['zustand/persist', unknown]], [], UiSlice> = (set) => ({
  activeTab: 'global',
  setActiveTab: (activeTab) => set({ activeTab }),
  selectedId: null,
  setSelectedId: (selectedId) => set({ selectedId }),
  search: '',
  setSearch: (search) => set({ search }),
  selectedOrg: null,
  setSelectedOrg: (selectedOrg) => set({ selectedOrg }),
  selectedGroupId: null,
  setSelectedGroupId: (selectedGroupId) => set({ selectedGroupId }),
});

/** Глобальный стор приложения (zustand + persist через конфиг бэкенда). */
export const useAppStore = create<AppStore>()(
  persist((...args) => ({ ...createSettingsSlice(...args), ...createUiSlice(...args) }), {
    name: 'phonebook-storage',
    storage: createJSONStorage(() => (isTauri() ? configStorage : localStorage)),
    partialize: (state) => ({
      theme: state.theme,
      language: state.language,
      globalMode: state.globalMode,
      testMode: state.testMode,
      animationsEnabled: state.animationsEnabled,
      syncIntervalHours: state.syncIntervalHours,
      hideEmptyContacts: state.hideEmptyContacts,
      emailOverrides: state.emailOverrides,
      ldapConfigs: state.ldapConfigs,
      savedContactIds: state.savedContactIds,
      orgGroups: state.orgGroups,
      enterpriseGroupId: state.enterpriseGroupId,
      externalPhonebookPath: state.externalPhonebookPath,
      externalPhonebookEnabled: state.externalPhonebookEnabled,
    }),
    /** Гидрация асинхронная (чтение config.json через IPC) — запускается из App. */
    skipHydration: true,
  }),
);

/** Селектор «контакт в избранном» (стабильная ссылка через zustand selector). */
export const selectIsContactSaved =
  (id: string) =>
  (state: AppStore): boolean =>
    state.savedContactIds.includes(id);
