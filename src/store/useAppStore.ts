import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isTauri } from '@/api/backend';
import type { LdapOrgConfigDto, OrgGroupDto } from '@/api/contracts';
import type { TabType } from '@/types';

import { configStorage } from './configStorage';

/** The appearance theme: light / dark / system. */
import type { LanguageCode, ThemeName } from '@/api/contracts';

export type { LanguageCode, ThemeName };
/** The interface language. */

/** Persisted settings (in the desktop they live in config.json + keyring). */
interface SettingsSlice {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  globalMode: boolean;
  setGlobalMode: (value: boolean) => void;
  /** Administrative settings come from an embedded managed profile. */
  managed: boolean;
  managedProfile: string | null;
  managedRevision: number | null;
  testMode: boolean;
  setTestMode: (value: boolean) => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (value: boolean) => void;
  /** Show contact photos as avatars; when false, letter initials are used. */
  showAvatars: boolean;
  setShowAvatars: (value: boolean) => void;
  syncIntervalHours: number;
  setSyncIntervalHours: (hours: number) => void;
  ldapConnectTimeoutSecs: number;
  setLdapConnectTimeoutSecs: (seconds: number) => void;
  ldapOperationTimeoutSecs: number;
  setLdapOperationTimeoutSecs: (seconds: number) => void;
  hideEmptyContacts: boolean;
  setHideEmptyContacts: (value: boolean) => void;
  emailOverrides: Record<string, string>;
  setEmailOverride: (contactId: string, email: string) => void;
  ldapConfigs: LdapOrgConfigDto[];
  setLdapConfigs: (configs: LdapOrgConfigDto[]) => void;
  /** Named organization groups (combined filters). */
  orgGroups: OrgGroupDto[];
  /** Creates or updates a group (by identifier). */
  saveOrgGroup: (group: OrgGroupDto) => void;
  removeOrgGroup: (id: string) => void;
  /** A full replacement of the group set (exchange file import); persistence is normal. */
  setOrgGroups: (groups: OrgGroupDto[]) => void;
  /** The group for the "KMAruda" tab (non-global version). */
  enterpriseGroupId: string | null;
  /** External phone book files (Yealink IPPhoneBook XML), one source per file. */
  externalPhonebookPaths: string[];
  setExternalPhonebookPaths: (paths: string[]) => void;
  /** Load external phone book files into the directory. */
  externalPhonebookEnabled: boolean;
  setExternalPhonebookEnabled: (enabled: boolean) => void;
  /** Per-file refresh interval in hours; absent/0 means manual only. */
  externalPhonebookIntervals: Record<string, number>;
  setExternalPhonebookInterval: (path: string, hours: number) => void;
  /** Hide Yealink entries that duplicate an AD employee. */
  externalHideAdDuplicates: boolean;
  setExternalHideAdDuplicates: (hidden: boolean) => void;
  setEnterpriseGroupId: (id: string | null) => void;
  savedContactIds: string[];
  toggleSavedContact: (id: string) => void;
}

/** Ephemeral UI state — not persisted. */
interface UiSlice {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  search: string;
  setSearch: (search: string) => void;
  selectedOrg: string | null;
  setSelectedOrg: (org: string | null) => void;
  /** The selected organization filter group (global version). */
  selectedGroupId: string | null;
  setSelectedGroupId: (id: string | null) => void;
}

/** The root store type: a settings slice + a UI slice. */
export type AppStore = SettingsSlice & UiSlice;

const createSettingsSlice: StateCreator<AppStore, [['zustand/persist', unknown]], [], SettingsSlice> = (set) => ({
  theme: 'system',
  setTheme: (theme) => set({ theme }),
  language: 'en',
  setLanguage: (language) => {
    try {
      localStorage.setItem('phonebook-language-user', '1');
    } catch {
      // localStorage may be unavailable in a restricted WebView.
    }
    set({ language });
  },
  globalMode: false,
  setGlobalMode: (globalMode) => set({ globalMode }),
  managed: false,
  managedProfile: null,
  managedRevision: null,
  testMode: false,
  setTestMode: (testMode) => set({ testMode }),
  animationsEnabled: true,
  setAnimationsEnabled: (animationsEnabled) => set({ animationsEnabled }),
  showAvatars: true,
  setShowAvatars: (showAvatars) => set({ showAvatars }),
  syncIntervalHours: 24,
  setSyncIntervalHours: (syncIntervalHours) => set({ syncIntervalHours }),
  ldapConnectTimeoutSecs: 15,
  setLdapConnectTimeoutSecs: (ldapConnectTimeoutSecs) => set({ ldapConnectTimeoutSecs }),
  ldapOperationTimeoutSecs: 30,
  setLdapOperationTimeoutSecs: (ldapOperationTimeoutSecs) => set({ ldapOperationTimeoutSecs }),
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
      // The enterprise tab reference must not point to a deleted group.
      enterpriseGroupId: state.enterpriseGroupId === id ? null : state.enterpriseGroupId,
    })),
  enterpriseGroupId: null,
  setEnterpriseGroupId: (enterpriseGroupId) => set({ enterpriseGroupId }),
  externalPhonebookPaths: [],
  setExternalPhonebookPaths: (externalPhonebookPaths) => set({ externalPhonebookPaths }),
  externalPhonebookEnabled: false,
  setExternalPhonebookEnabled: (externalPhonebookEnabled) => set({ externalPhonebookEnabled }),
  externalPhonebookIntervals: {},
  setExternalPhonebookInterval: (path, hours) =>
    set((state) => {
      const next = { ...state.externalPhonebookIntervals };
      if (hours > 0) {
        next[path] = hours;
      } else {
        delete next[path];
      }
      return { externalPhonebookIntervals: next };
    }),
  externalHideAdDuplicates: true,
  setExternalHideAdDuplicates: (externalHideAdDuplicates) => set({ externalHideAdDuplicates }),
  savedContactIds: [],
  toggleSavedContact: (id) =>
    set((state) => {
      const ids = new Set(state.savedContactIds);
      const wasSaved = ids.has(id);
      if (wasSaved) {
        ids.delete(id);
      } else {
        ids.add(id);
      }
      return {
        savedContactIds: [...ids],
        // In "My contacts" the removed record disappears from the list, so the
        // open card must close immediately. On search/holding tabs the contact
        // still exists in the directory: keep the card open and only update the
        // favorite flag, otherwise the auto-select effect can reopen it and feel
        // out of sync.
        selectedId: wasSaved && state.activeTab === 'local' && state.selectedId === id ? null : state.selectedId,
      };
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

/** The global app store (zustand + persist through the backend config). */
export const useAppStore = create<AppStore>()(
  persist((...args) => ({ ...createSettingsSlice(...args), ...createUiSlice(...args) }), {
    name: 'phonebook-storage',
    storage: createJSONStorage(() => (isTauri() ? configStorage : localStorage)),
    partialize: (state) => ({
      theme: state.theme,
      language: state.language,
      globalMode: state.globalMode,
      managed: state.managed,
      managedProfile: state.managedProfile,
      managedRevision: state.managedRevision,
      testMode: state.testMode,
      animationsEnabled: state.animationsEnabled,
      showAvatars: state.showAvatars,
      syncIntervalHours: state.syncIntervalHours,
      ldapConnectTimeoutSecs: state.ldapConnectTimeoutSecs,
      ldapOperationTimeoutSecs: state.ldapOperationTimeoutSecs,
      hideEmptyContacts: state.hideEmptyContacts,
      emailOverrides: state.emailOverrides,
      ldapConfigs: state.ldapConfigs,
      savedContactIds: state.savedContactIds,
      orgGroups: state.orgGroups,
      enterpriseGroupId: state.enterpriseGroupId,
      externalPhonebookPaths: state.externalPhonebookPaths,
      externalPhonebookEnabled: state.externalPhonebookEnabled,
      externalPhonebookIntervals: state.externalPhonebookIntervals,
      externalHideAdDuplicates: state.externalHideAdDuplicates,
    }),
    /** Hydration is asynchronous (reading config.json over IPC) — started from App. */
    skipHydration: true,
  }),
);

/** The "contact is favorite" selector (a stable reference via a zustand selector). */
export const selectIsContactSaved =
  (id: string) =>
  (state: AppStore): boolean =>
    state.savedContactIds.includes(id);
