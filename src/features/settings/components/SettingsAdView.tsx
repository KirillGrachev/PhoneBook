import { useMemo, useState } from 'react';
import { Loader2, Monitor, Plus, Refresh, Trash } from '@/components/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError, isTauri } from '@/api/backend';
import { configApi, contactsApi, syncApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import type { DuplicatesPreviewDto, LdapOrgConfigDto } from '@/api/contracts';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { TextField } from '@/components/ui/TextField';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { translateBackendError } from '@/lib/errors';
import { useAppStore } from '@/store/useAppStore';

import { primaryButton, toInput } from './settingsAdUtils';
import { SettingsAdOrgCard } from './SettingsAdOrgCard';
import { SettingsAdRemoveDialog } from './SettingsAdRemoveDialog';

const EMPTY_ORG: LdapOrgConfigDto = {
  organization: '',
  ldapUrl: '',
  baseDn: '',
  bindDn: null,
  useStartTls: false,
  allowInvalidTls: false,
  useIntegratedAuth: true,
  hasPassword: false,
};

const SYNC_INTERVAL_OPTIONS = [1, 6, 12, 24, 72, 168];

/**
 * Настройки Active Directory.
 *
 * * несколько организаций, каждая со своим контроллером, Base DN и учёткой;
 * * пароль уходит отдельной командой straight в keyring, минуя стор и config.json;
 * * «Проверить подключение» — диагностика через бэкенд (bind + rootDSE + выборка);
 * * ручной запуск синхронизации и статус последней по каждой организации;
 * * в браузере (без Tauri) форма скрыта: AD недоступен вне десктоп-приложения.
 */
export function SettingsAdView() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const testMode = useAppStore((state) => state.testMode);
  const setTestMode = useAppStore((state) => state.setTestMode);
  const ldapConfigs = useAppStore((state) => state.ldapConfigs);
  const setLdapConfigs = useAppStore((state) => state.setLdapConfigs);
  const syncIntervalHours = useAppStore((state) => state.syncIntervalHours);
  const setSyncIntervalHours = useAppStore((state) => state.setSyncIntervalHours);
  const ldapConnectTimeoutSecs = useAppStore((state) => state.ldapConnectTimeoutSecs);
  const setLdapConnectTimeoutSecs = useAppStore((state) => state.setLdapConnectTimeoutSecs);
  const ldapOperationTimeoutSecs = useAppStore((state) => state.ldapOperationTimeoutSecs);
  const setLdapOperationTimeoutSecs = useAppStore((state) => state.setLdapOperationTimeoutSecs);

  const { running: syncRunning, organizations: syncStates } = useSyncStatus();

  /** Введённые (ещё не сохранённые) пароли: организация → пароль. */
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [testingOrg, setTestingOrg] = useState<number | null>(null);
  const [removingOrg, setRemovingOrg] = useState<number | null>(null);
  const [dupBusy, setDupBusy] = useState<'preview' | 'apply' | null>(null);
  const [dupPreview, setDupPreview] = useState<DuplicatesPreviewDto | null>(null);

  const desktop = isTauri();

  const configs = useMemo(() => (ldapConfigs.length > 0 ? ldapConfigs : [EMPTY_ORG]), [ldapConfigs]);

  const updateOrg = (index: number, patch: Partial<LdapOrgConfigDto>) => {
    setLdapConfigs(configs.map((config, i) => (i === index ? { ...config, ...patch } : config)));
  };

  const addOrg = () => {
    setLdapConfigs([...configs, EMPTY_ORG]);
  };

  const removeOrg = async (index: number) => {
    const removed = configs[index];
    const next = configs.filter((_, i) => i !== index);
    setLdapConfigs(next);
    setRemovingOrg(null);
    if (desktop && removed.organization && removed.hasPassword) {
      try {
        await configApi.setPassword(removed.organization, null);
      } catch (error) {
        console.warn('[ad-settings] не удалось удалить секрет', error);
      }
    }
  };

  const testOrg = async (index: number) => {
    const config = configs[index];
    if (!config.organization.trim()) {
      toast.error(t('settings.ad.orgRequired'), { id: 'ad-test-error' });
      return;
    }
    const urls = config.ldapUrl
      .split(/[,;]/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (urls.length === 0 || urls.some((url) => !/^ldaps?:\/\/.+/i.test(url))) {
      toast.error(t('settings.ad.invalidUrl'), { id: 'ad-test-error' });
      return;
    }

    setTestingOrg(index);
    try {
      const draftPassword = passwordDrafts[config.organization]?.trim();
      const result = await configApi.testConnection(
        toInput(config),
        draftPassword || null,
        ldapConnectTimeoutSecs,
        ldapOperationTimeoutSecs,
      );

      const details = [
        result.serverDnsName ? t('settings.ad.testServer', { server: result.serverDnsName }) : null,
        result.defaultNamingContext ? t('settings.ad.testNamingContext', { nc: result.defaultNamingContext }) : null,
        result.sampleNames.length > 0
          ? t('settings.ad.testSample', {
              names: result.sampleNames.join(', ') + (result.sampleIsTruncated ? ` ${t('settings.ad.testMore')}` : ''),
            })
          : t('settings.ad.testNoUsers'),
      ]
        .filter(Boolean)
        .join('\n');

      toast.success(t('settings.ad.testOk', { ms: result.bindMs }), {
        id: 'ad-test-result',
        description: details,
        duration: 10_000,
      });

      // Подсказка rootDSE: если Base DN пуст — предлагаем доменный корень.
      if (!config.baseDn.trim() && result.defaultNamingContext) {
        updateOrg(index, { baseDn: result.defaultNamingContext });
        toast.info(t('settings.ad.baseDnAutofilled'), { id: 'ad-base-autofill' });
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? translateBackendError(error, t) : String(error), {
        id: 'ad-test-result',
        duration: 8_000,
      });
    } finally {
      setTestingOrg(null);
    }
  };

  const savePassword = async (index: number) => {
    const config = configs[index];
    const password = passwordDrafts[config.organization] ?? '';
    if (!config.organization.trim()) {
      toast.error(t('settings.ad.orgRequired'), { id: 'ad-password-error' });
      return;
    }
    try {
      await configApi.setPassword(config.organization, password || null);
      setPasswordDrafts((drafts) => ({ ...drafts, [config.organization]: '' }));
      const saved = await configApi.load();
      setLdapConfigs(saved.ldapConfigs);
      toast.success(password ? t('settings.ad.passwordSavedToast') : t('settings.ad.passwordClearedToast'), {
        id: 'ad-password-result',
      });
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'ad-password-result' });
    }
  };

  const syncNow = async () => {
    devLog('sync', { manual: true });
    try {
      const started = await syncApi.start(true);
      if (started) {
        toast.info(t('sync.started'), { id: 'sync-manual' });
      } else {
        toast.warning(t('sync.alreadyRunning'), { id: 'sync-manual' });
      }
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'sync-manual' });
    }
  };

  /** Превью дубликатов: пусто — тост, иначе подтверждающий диалог. */
  const handleDuplicatesCheck = async () => {
    setDupBusy('preview');
    try {
      const preview = await contactsApi.previewDuplicates();
      devLog('dedup', { preview });
      if (preview.groups === 0) {
        toast.success(t('settings.ad.duplicatesNone'));
      } else {
        setDupPreview(preview);
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'dedup-error' });
    } finally {
      setDupBusy(null);
    }
  };

  /** Уборка дубликатов с инвалидацией выдач справочника. */
  const handleDuplicatesApply = async () => {
    setDupBusy('apply');
    try {
      const removed = await contactsApi.deduplicate();
      devLog('dedup', { removed });
      toast.success(t('settings.ad.duplicatesDone', { count: removed }));
      setDupPreview(null);
      for (const key of ['contacts', 'contact', 'contacts-count', 'organizations'] as const) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'dedup-error' });
    } finally {
      setDupBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full h-full relative">
      <div className="flex flex-col gap-6 pb-6">
        {/* Тестовый режим — доступен везде (в браузере включает демо-данные) */}
        <div className="flex items-center justify-between border border-border bg-surface p-4 rounded-[16px] shadow-sm shrink-0">
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-[16px] font-bold text-foreground">{t('testMode')}</span>
            <span className="text-[14px] text-muted-foreground leading-snug">{t('testModeDesc')}</span>
          </div>
          <Switch
            checked={testMode}
            onChange={setTestMode}
            ariaLabel={t('testMode')}
            activeClassName="bg-amber-500 border-amber-500"
          />
        </div>

        {!desktop && (
          <div className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
            <div className="flex items-center gap-3">
              <Monitor className="w-6 h-6 text-primary shrink-0" aria-hidden />
              <span className="text-[15px] font-bold text-foreground">{t('browserMode.adTitle')}</span>
            </div>
            <p className="text-[14px] text-muted-foreground leading-relaxed">{t('browserMode.adDesc')}</p>
          </div>
        )}

        {desktop && (
          <>
            {/* Организации */}
            <section className="flex flex-col gap-4" aria-label={t('settings.adSettings')}>
              {configs.map((config, index) => (
                <SettingsAdOrgCard
                  key={index}
                  config={config}
                  index={index}
                  passwordDraft={passwordDrafts[config.organization] ?? ''}
                  testing={testingOrg === index}
                  busy={testingOrg !== null}
                  locale={i18n.language}
                  syncStates={syncStates}
                  onChange={(patch) => updateOrg(index, patch)}
                  onPasswordChange={(value) =>
                    setPasswordDrafts((drafts) => ({ ...drafts, [config.organization]: value }))
                  }
                  onSavePassword={() => void savePassword(index)}
                  onRemove={() => setRemovingOrg(index)}
                  onTest={() => void testOrg(index)}
                />
              ))}

              <button
                type="button"
                onClick={addOrg}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-[16px] border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-surface transition-all cursor-pointer text-[15px] font-semibold"
              >
                <Plus className="w-[18px] h-[18px]" aria-hidden />
                {t('settings.ad.addOrg')}
              </button>
            </section>

            {/* Синхронизация */}
            <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
              <h3 className="text-[14px] font-bold text-muted-foreground uppercase">
                {t('settings.ad.lastSyncTitle')}
              </h3>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold text-foreground">{t('settings.ad.syncInterval')}</span>
                <Select
                  value={syncIntervalHours}
                  onChange={(hours) => setSyncIntervalHours(hours)}
                  ariaLabel={t('settings.ad.syncInterval')}
                  options={SYNC_INTERVAL_OPTIONS.map((hours) => ({
                    value: hours,
                    label: t('settings.ad.syncIntervalHours', { count: hours }),
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField
                  type="number"
                  min={1}
                  max={300}
                  label={t('settings.ad.connectTimeout')}
                  hint={t('settings.ad.connectTimeoutHint')}
                  value={ldapConnectTimeoutSecs}
                  onChange={(event) =>
                    setLdapConnectTimeoutSecs(Math.min(300, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
                <TextField
                  type="number"
                  min={1}
                  max={300}
                  label={t('settings.ad.operationTimeout')}
                  hint={t('settings.ad.operationTimeoutHint')}
                  value={ldapOperationTimeoutSecs}
                  onChange={(event) =>
                    setLdapOperationTimeoutSecs(Math.min(300, Math.max(1, Number(event.target.value) || 1)))
                  }
                />
              </div>

              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={testMode || syncRunning}
                className={primaryButton(testMode || syncRunning, 'w-full h-11 mt-1 text-[15px]')}
              >
                {syncRunning ? (
                  <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />
                ) : (
                  <Refresh className="w-[18px] h-[18px]" aria-hidden />
                )}
                {syncRunning ? t('sync.running') : t('sync.now')}
              </button>
            </section>

            {/* Уборка дубликатов учёток */}
            <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
              <h3 className="text-[14px] font-bold text-muted-foreground uppercase">
                {t('settings.ad.duplicatesTitle')}
              </h3>
              <p className="text-[15px] text-muted-foreground leading-relaxed">{t('settings.ad.duplicatesDesc')}</p>
              <button
                type="button"
                onClick={() => void handleDuplicatesCheck()}
                disabled={dupBusy !== null || testMode}
                className={primaryButton(dupBusy !== null || testMode, 'w-full h-11 text-[15px]')}
              >
                {dupBusy === 'preview' ? (
                  <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />
                ) : (
                  <Trash className="w-[18px] h-[18px]" aria-hidden />
                )}
                {t('settings.ad.duplicatesCheck')}
              </button>
            </section>

            {dupPreview && (
              <div
                className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center p-4"
                role="alertdialog"
                aria-modal="true"
              >
                <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDupPreview(null)} />
                <div className="relative bg-surface w-full max-w-[420px] rounded-[20px] shadow-2xl border border-border p-6 flex flex-col gap-4 z-10">
                  <h3 className="text-[18px] font-bold text-foreground m-0">
                    {t('settings.ad.duplicatesConfirmTitle')}
                  </h3>
                  <p className="text-[14px] text-muted-foreground leading-relaxed m-0">
                    {t('settings.ad.duplicatesConfirmMsg', {
                      groups: dupPreview.groups,
                      records: dupPreview.removable,
                      samples: dupPreview.samples.join(', '),
                    })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDupPreview(null)}
                      className="px-4 py-2 rounded-[12px] text-[14px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer"
                    >
                      {t('settings.orgGroupsCancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDuplicatesApply()}
                      disabled={dupBusy !== null}
                      className="flex items-center gap-2 px-4 py-2 rounded-[12px] bg-primary text-white text-[14px] font-bold hover:bg-primary-hover transition-colors outline-none cursor-pointer disabled:opacity-60"
                    >
                      {dupBusy === 'apply' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                      {t('settings.ad.duplicatesApply')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-2 p-4 border border-blue-500/20 bg-blue-500/5 rounded-[12px] shrink-0">
          <p className="text-[15px] text-blue-500 leading-relaxed font-medium">{t('adSettingsInfo')}</p>
        </div>
      </div>

      {removingOrg !== null && (
        <SettingsAdRemoveDialog
          organization={configs[removingOrg]?.organization ?? ''}
          onCancel={() => setRemovingOrg(null)}
          onConfirm={() => void removeOrg(removingOrg)}
        />
      )}
    </div>
  );
}
