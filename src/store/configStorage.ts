/**
 * The zustand-persist ↔ Rust configuration bridge (`config.json` + keyring).
 *
 * Notes:
 * * writes to the backend are debounced (400 ms) - fast
 * toggles do not spam IPC and disk I/O;
 * * LDAP passwords do NOT travel through this bridge: `ldapConfigs` contain only
 * the `hasPassword` flag; the secret is set by a separate command
 * `set_ldap_password` from the AD settings screen;
 * * the `save_config` response (the backend-normalized config) is reconciled
 * against the current state and applied only on divergence —
 * this breaks the potential persist → setState → persist cycle.
 */
import { toast } from 'sonner';
import type { StateStorage } from 'zustand/middleware';

import { configApi } from '@/api/directory';
import type { AppConfigDto, LdapOrgInput } from '@/api/contracts';
import i18n from '@/lib/i18n';

import { useAppStore } from './useAppStore';

const SAVE_DEBOUNCE_MS = 400;

interface PersistedState {
  theme: string;
  language: string;
  globalMode: boolean;
  managed: boolean;
  managedProfile: string | null;
  managedRevision: number | null;
  testMode: boolean;
  animationsEnabled: boolean;
  showAvatars: boolean;
  syncIntervalHours: number;
  ldapConnectTimeoutSecs: number;
  ldapOperationTimeoutSecs: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  ldapConfigs: AppConfigDto['ldapConfigs'];
  savedContactIds: string[];
  orgGroups: AppConfigDto['orgGroups'];
  enterpriseGroupId: string | null;
  externalPhonebookPaths: string[];
  externalPhonebookEnabled: boolean;
  externalPhonebookIntervals: Record<string, number>;
  externalHideAdDuplicates: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingValue: string | null = null;

function toLdapOrgInput(config: AppConfigDto['ldapConfigs'][number]): LdapOrgInput {
  return {
    organization: config.organization,
    ldapUrl: config.ldapUrl,
    baseDn: config.baseDn,
    bindDn: config.bindDn ?? null,
    useStartTls: config.useStartTls,
    allowInvalidTls: config.allowInvalidTls,
    useIntegratedAuth: config.useIntegratedAuth,
  };
}

async function persistNow(value: string): Promise<void> {
  try {
    const parsed = JSON.parse(value) as { state?: Partial<PersistedState> };
    const state = parsed.state ?? {};
    const saved = await configApi.save({
      theme: state.theme ?? 'system',
      language: state.language ?? 'en',
      globalMode: state.globalMode ?? false,
      testMode: state.testMode ?? false,
      animationsEnabled: state.animationsEnabled ?? true,
      showAvatars: state.showAvatars ?? true,
      syncIntervalHours: state.syncIntervalHours ?? 24,
      ldapConnectTimeoutSecs: state.ldapConnectTimeoutSecs ?? 15,
      ldapOperationTimeoutSecs: state.ldapOperationTimeoutSecs ?? 30,
      hideEmptyContacts: state.hideEmptyContacts ?? true,
      emailOverrides: state.emailOverrides ?? {},
      savedContactIds: state.savedContactIds ?? [],
      orgGroups: state.orgGroups ?? [],
      enterpriseGroupId: state.enterpriseGroupId ?? null,
      externalPhonebookPath: (state.externalPhonebookPaths ?? [])[0] ?? null,
      externalPhonebookPaths: state.externalPhonebookPaths ?? [],
      externalPhonebookEnabled: state.externalPhonebookEnabled ?? false,
      externalPhonebookIntervals: state.externalPhonebookIntervals ?? {},
      externalHideAdDuplicates: state.externalHideAdDuplicates ?? true,
      // Do not save untitled drafts: the backend validates the name,
      // while an unfilled card is not an organization yet.
      ldapConfigs: (state.ldapConfigs ?? []).filter((org) => org.organization.trim() !== '').map(toLdapOrgInput),
    });

    // The backend normalized the config (trim, validation, hasPassword from the keyring).
    // We apply the divergences back into the store without provoking a new cycle.
    // Compare without drafts: otherwise unsaved cards would be overwritten
    // backend response on every autosave.
    const current = useAppStore.getState().ldapConfigs.filter((org) => org.organization.trim() !== '');
    if (JSON.stringify(current) !== JSON.stringify(saved.ldapConfigs)) {
      useAppStore.setState({ ldapConfigs: saved.ldapConfigs });
    }

    // The backend normalizes groups (trim, deduplication) and resets a broken
    // enterprise tab reference: apply discrepancies the same way.
    const storeState = useAppStore.getState();
    if (JSON.stringify(storeState.orgGroups) !== JSON.stringify(saved.orgGroups)) {
      useAppStore.setState({ orgGroups: saved.orgGroups });
    }
    if (storeState.enterpriseGroupId !== saved.enterpriseGroupId) {
      useAppStore.setState({ enterpriseGroupId: saved.enterpriseGroupId });
    }
    if (saved.managed) {
      useAppStore.setState({
        managed: true,
        managedProfile: saved.managedProfile,
        managedRevision: saved.managedRevision,
      });
    }
  } catch (error) {
    console.error('[configStorage] failed to save configuration', error);
    toast.error(i18n.t('settings.saveError'), { id: 'config-save-error' });
  }
}

function scheduleSave(value: string): void {
  pendingValue = value;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const value = pendingValue;
    pendingValue = null;
    if (value !== null) {
      void persistNow(value);
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Storage persist through the backend: reading `config.json` and debounced saving. */
export const configStorage: StateStorage = {
  getItem: async (): Promise<string | null> => {
    try {
      const config = await configApi.load();
      let language = config.language;
      try {
        // Existing installs with the old RU default are migrated to English
        // once; an explicit language choice is never overridden.
        if (language === 'ru' && !localStorage.getItem('phonebook-language-user')) {
          language = 'en';
        }
      } catch {
        // localStorage may be unavailable; keep the backend value.
      }
      return JSON.stringify({
        state: {
          theme: config.theme,
          language,
          globalMode: config.globalMode,
          managed: config.managed,
          managedProfile: config.managedProfile,
          managedRevision: config.managedRevision,
          testMode: config.testMode,
          animationsEnabled: config.animationsEnabled,
          showAvatars: config.showAvatars ?? true,
          syncIntervalHours: config.syncIntervalHours,
          ldapConnectTimeoutSecs: config.ldapConnectTimeoutSecs ?? 15,
          ldapOperationTimeoutSecs: config.ldapOperationTimeoutSecs ?? 30,
          hideEmptyContacts: config.hideEmptyContacts,
          emailOverrides: config.emailOverrides,
          ldapConfigs: config.ldapConfigs,
          savedContactIds: config.savedContactIds,
          // Organization groups and the enterprise tab mark must
          // survive restart: without them hydration wiped the imported
          // and created groups with the default empty value.
          orgGroups: config.orgGroups,
          enterpriseGroupId: config.enterpriseGroupId,
          externalPhonebookPaths:
            config.externalPhonebookPaths?.length > 0
              ? config.externalPhonebookPaths
              : config.externalPhonebookPath
                ? [config.externalPhonebookPath]
                : [],
          externalPhonebookEnabled: config.externalPhonebookEnabled,
          externalPhonebookIntervals: config.externalPhonebookIntervals ?? {},
          externalHideAdDuplicates: config.externalHideAdDuplicates ?? true,
        },
        version: 0,
      });
    } catch (error) {
      console.error('[configStorage] failed to load configuration', error);
      return null;
    }
  },

  setItem: async (_name: string, value: string): Promise<void> => {
    scheduleSave(value);
  },

  removeItem: async (): Promise<void> => {
    // The configuration is not deleted: the reset is done by writing defaults.
  },
};

/** Immediately flush accumulated changes to disk (e.g. on exit). */
export async function flushConfigSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const value = pendingValue;
  pendingValue = null;
  if (value !== null) {
    await persistNow(value);
  }
}
