/**
 * Мост zustand-persist ↔ Rust-конфигурация (`config.json` + keyring).
 *
 * Особенности:
 * * запись на бэкенд дебounced-ится (400 мс) — быстрые переключения
 *   тумблеров не спамят IPC и disk I/O;
 * * пароли LDAP через этот мост НЕ ходят: `ldapConfigs` содержат только
 *   флаг `hasPassword`, секрет устанавливается отдельной командой
 *   `set_ldap_password` из экрана настроек AD;
 * * ответ `save_config` (нормализованный бэкендом конфиг) сверяется
 *   с текущим состоянием и применяется только при расхождении —
 *   это разрывает потенциальный цикл persist → setState → persist.
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
  testMode: boolean;
  animationsEnabled: boolean;
  syncIntervalHours: number;
  hideEmptyContacts: boolean;
  emailOverrides: Record<string, string>;
  ldapConfigs: AppConfigDto['ldapConfigs'];
  savedContactIds: string[];
  orgGroups: AppConfigDto['orgGroups'];
  enterpriseGroupId: string | null;
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
      language: state.language ?? 'ru',
      globalMode: state.globalMode ?? false,
      testMode: state.testMode ?? false,
      animationsEnabled: state.animationsEnabled ?? true,
      syncIntervalHours: state.syncIntervalHours ?? 24,
      hideEmptyContacts: state.hideEmptyContacts ?? true,
      emailOverrides: state.emailOverrides ?? {},
      savedContactIds: state.savedContactIds ?? [],
      orgGroups: state.orgGroups ?? [],
      enterpriseGroupId: state.enterpriseGroupId ?? null,
      // Черновики без названия не сохраняем: бэкенд валидирует имя,
      // а незаполненная карточка — это ещё не организация.
      ldapConfigs: (state.ldapConfigs ?? []).filter((org) => org.organization.trim() !== '').map(toLdapOrgInput),
    });

    // Бэкенд нормализовал конфиг (trim, валидация, hasPassword из keyring).
    // Применяем расхождения обратно в store, не провоцируя новый цикл.
    // Сверяем без черновиков: иначе несохранённые карточки затирались бы
    // ответом бэкенда при каждом автосохранении.
    const current = useAppStore.getState().ldapConfigs.filter((org) => org.organization.trim() !== '');
    if (JSON.stringify(current) !== JSON.stringify(saved.ldapConfigs)) {
      useAppStore.setState({ ldapConfigs: saved.ldapConfigs });
    }

    // Бэкенд нормализует группы (trim, дедупликация) и сбрасывает битую
    // ссылку вкладки предприятия: применяем расхождения тем же способом.
    const storeState = useAppStore.getState();
    if (JSON.stringify(storeState.orgGroups) !== JSON.stringify(saved.orgGroups)) {
      useAppStore.setState({ orgGroups: saved.orgGroups });
    }
    if (storeState.enterpriseGroupId !== saved.enterpriseGroupId) {
      useAppStore.setState({ enterpriseGroupId: saved.enterpriseGroupId });
    }
  } catch (error) {
    console.error('[configStorage] не удалось сохранить конфигурацию', error);
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

/** Storage persist через бэкенд: чтение `config.json` и дебаунс-сохранение. */
export const configStorage: StateStorage = {
  getItem: async (): Promise<string | null> => {
    try {
      const config = await configApi.load();
      return JSON.stringify({
        state: {
          theme: config.theme,
          language: config.language,
          globalMode: config.globalMode,
          testMode: config.testMode,
          animationsEnabled: config.animationsEnabled,
          syncIntervalHours: config.syncIntervalHours,
          hideEmptyContacts: config.hideEmptyContacts,
          emailOverrides: config.emailOverrides,
          ldapConfigs: config.ldapConfigs,
          savedContactIds: config.savedContactIds,
          // Группы организаций и отметка вкладки предприятия обязаны
          // переживать перезапуск: без них гидрация затирала импортированные
          // и созданные группы дефолтным пустым значением.
          orgGroups: config.orgGroups,
          enterpriseGroupId: config.enterpriseGroupId,
        },
        version: 0,
      });
    } catch (error) {
      console.error('[configStorage] не удалось загрузить конфигурацию', error);
      return null;
    }
  },

  setItem: async (_name: string, value: string): Promise<void> => {
    scheduleSave(value);
  },

  removeItem: async (): Promise<void> => {
    // Конфигурация не удаляется: сброс выполняется записью дефолтов.
  },
};

/** Немедленно сбросить накопленные изменения на диск (например, при выходе). */
export function flushConfigSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const value = pendingValue;
  pendingValue = null;
  if (value !== null) {
    void persistNow(value);
  }
}
