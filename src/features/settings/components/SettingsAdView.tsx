import { useMemo, useState } from 'react';
import {
  FlaskConical,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  PlugZap,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError, isTauri } from '@/api/backend';
import { configApi, contactsApi, syncApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import type { DuplicatesPreviewDto, LdapOrgConfigDto, LdapOrgInput } from '@/api/contracts';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { TextField } from '@/components/ui/TextField';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { translateBackendError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

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

/** Схема LDAP-URL: 'ldap' | 'ldaps' | null. */
function urlScheme(url: string): 'ldap' | 'ldaps' | null {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('ldaps://')) return 'ldaps';
  if (normalized.startsWith('ldap://')) return 'ldap';
  return null;
}

function toInput(config: LdapOrgConfigDto): LdapOrgInput {
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

/** Основная (активная) кнопка; в disabled — нейтральный стиль, а не «полупрозрачный primary». */
function primaryButton(disabled: boolean, extra?: string): string {
  return cn(
    'flex items-center justify-center gap-2 rounded-[10px] text-[13px] font-bold transition-colors',
    disabled
      ? 'bg-input text-muted-foreground border border-border cursor-not-allowed'
      : 'bg-primary text-white hover:bg-primary-hover cursor-pointer',
    extra,
  );
}

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
    if (!/^ldaps?:\/\/.+/i.test(config.ldapUrl.trim())) {
      toast.error(t('settings.ad.invalidUrl'), { id: 'ad-test-error' });
      return;
    }

    setTestingOrg(index);
    try {
      const draftPassword = passwordDrafts[config.organization]?.trim();
      const result = await configApi.testConnection(toInput(config), draftPassword || null);

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
          <div className="flex items-center gap-3 pr-4">
            <div className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-[10px] bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <FlaskConical className="w-[18px] h-[18px]" aria-hidden />
            </div>
            <div className="flex flex-col gap-0.5 ml-1">
              <span className="text-[16px] font-bold text-foreground">{t('testMode')}</span>
              <span className="text-[13px] text-muted-foreground leading-snug">{t('testModeDesc')}</span>
            </div>
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
              <div className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-[10px] bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <MonitorSmartphone className="w-[18px] h-[18px]" aria-hidden />
              </div>
              <span className="text-[15px] font-bold text-foreground">{t('browserMode.adTitle')}</span>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">{t('browserMode.adDesc')}</p>
          </div>
        )}

        {desktop && (
          <>
            {/* Организации */}
            <section className="flex flex-col gap-4" aria-label={t('settings.adSettings')}>
              {configs.map((config, index) => (
                <article
                  key={index}
                  className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm"
                >
                  <header className="flex items-center justify-between">
                    <h3 className="text-[13px] font-bold text-muted-foreground uppercase">
                      {config.organization || `#${index + 1}`}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setRemovingOrg(index)}
                      className="flex items-center gap-1.5 text-[13px] font-semibold text-red-500 hover:text-red-600 transition-colors cursor-pointer bg-transparent border-0 p-1 outline-none"
                      aria-label={t('settings.ad.removeOrg')}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                      {t('settings.ad.removeOrg')}
                    </button>
                  </header>

                  <TextField
                    label={t('settings.ad.organization')}
                    value={config.organization}
                    onChange={(event) => updateOrg(index, { organization: event.target.value })}
                    placeholder={t('settings.ad.organizationPlaceholder')}
                    autoComplete="off"
                  />
                  <TextField
                    label={t('settings.ad.ldapUrl')}
                    value={config.ldapUrl}
                    onChange={(event) => updateOrg(index, { ldapUrl: event.target.value })}
                    placeholder="ldap://dc1.kmaruda.ru или ldaps://dc1.kmaruda.ru:636"
                    className="font-mono"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="off"
                    hint={
                      urlScheme(config.ldapUrl) === 'ldaps'
                        ? t('settings.ad.schemeLdaps')
                        : urlScheme(config.ldapUrl) === 'ldap'
                          ? t('settings.ad.schemeLdap')
                          : undefined
                    }
                  />
                  <TextField
                    label={t('settings.ad.baseDn')}
                    value={config.baseDn}
                    onChange={(event) => updateOrg(index, { baseDn: event.target.value })}
                    placeholder="DC=kmaruda,DC=ru"
                    hint={t('settings.ad.baseDnHint')}
                    className="font-mono"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <div className="flex flex-col gap-2 pt-1">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="flex flex-col">
                        <span className="text-[14px] font-semibold text-foreground">
                          {t('settings.ad.integratedAuth')}
                        </span>
                        <span className="text-[12px] text-muted-foreground">{t('settings.ad.integratedAuthDesc')}</span>
                      </span>
                      <Switch
                        checked={config.useIntegratedAuth}
                        onChange={(checked) => updateOrg(index, { useIntegratedAuth: checked })}
                        ariaLabel={t('settings.ad.integratedAuth')}
                      />
                    </label>
                    {config.useIntegratedAuth && (
                      <span className="text-[12px] text-muted-foreground leading-snug">
                        {t('settings.ad.integratedAuthHint')}
                      </span>
                    )}
                  </div>

                  {!config.useIntegratedAuth && (
                    <>
                      <TextField
                        label={t('settings.ad.bindDn')}
                        value={config.bindDn ?? ''}
                        onChange={(event) => updateOrg(index, { bindDn: event.target.value || null })}
                        placeholder="svc_phonebook@kmaruda.ru"
                        hint={t('settings.ad.bindDnHint')}
                        autoCapitalize="none"
                        spellCheck={false}
                        autoComplete="off"
                      />

                      {/* Пароль: отдельный защищённый канал, не проходит через стор */}
                      <div className="flex flex-col gap-2">
                        <TextField
                          label={t('settings.ad.password')}
                          type="password"
                          value={passwordDrafts[config.organization] ?? ''}
                          onChange={(event) =>
                            setPasswordDrafts((drafts) => ({ ...drafts, [config.organization]: event.target.value }))
                          }
                          placeholder={
                            config.hasPassword ? t('settings.ad.passwordSaved') : t('settings.ad.passwordPlaceholder')
                          }
                          autoComplete="new-password"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void savePassword(index)}
                            disabled={
                              !config.organization.trim() || !(passwordDrafts[config.organization] ?? '').trim()
                            }
                            className={primaryButton(
                              !config.organization.trim() || !(passwordDrafts[config.organization] ?? '').trim(),
                              'px-3 py-1.5',
                            )}
                          >
                            <KeyRound className="w-3.5 h-3.5" aria-hidden />
                            {t('settings.ad.savePassword')}
                          </button>
                          {config.hasPassword && (
                            <button
                              type="button"
                              onClick={() => void savePassword(index)}
                              className="px-3 py-1.5 rounded-[10px] border border-border text-foreground/70 text-[13px] font-semibold hover:bg-surface-hover transition-colors cursor-pointer"
                            >
                              {t('settings.ad.clearPassword')}
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <label
                      className={cn(
                        'flex items-center justify-between gap-3',
                        urlScheme(config.ldapUrl) === 'ldaps' ? 'opacity-60' : 'cursor-pointer',
                      )}
                    >
                      <span className="flex flex-col">
                        <span className="text-[14px] font-semibold text-foreground">
                          {t('settings.ad.useStartTls')}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {urlScheme(config.ldapUrl) === 'ldaps'
                            ? t('settings.ad.startTlsNotNeeded')
                            : t('settings.ad.useStartTlsDesc')}
                        </span>
                      </span>
                      <Switch
                        checked={urlScheme(config.ldapUrl) === 'ldaps' ? false : config.useStartTls}
                        disabled={urlScheme(config.ldapUrl) === 'ldaps'}
                        onChange={(checked) => updateOrg(index, { useStartTls: checked })}
                        ariaLabel={t('settings.ad.useStartTls')}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <span className="flex flex-col">
                        <span className="text-[14px] font-semibold text-foreground flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden />
                          {t('settings.ad.allowInvalidTls')}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {t('settings.ad.allowInvalidTlsDesc')}
                        </span>
                      </span>
                      <Switch
                        checked={config.allowInvalidTls}
                        onChange={(checked) => updateOrg(index, { allowInvalidTls: checked })}
                        ariaLabel={t('settings.ad.allowInvalidTls')}
                        activeClassName="bg-amber-500 border-amber-500"
                      />
                    </label>
                  </div>

                  <footer className="flex flex-col items-center gap-2 pt-3 border-t border-border/60">
                    <button
                      type="button"
                      onClick={() => void testOrg(index)}
                      disabled={testingOrg !== null}
                      className={primaryButton(testingOrg !== null, 'px-4 py-2')}
                    >
                      {testingOrg === index ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <PlugZap className="w-4 h-4" aria-hidden />
                      )}
                      {testingOrg === index ? t('settings.ad.testing') : t('settings.ad.test')}
                    </button>
                    <SyncMetaLine organization={config.organization} syncStates={syncStates} locale={i18n.language} />
                  </footer>
                </article>
              ))}

              <button
                type="button"
                onClick={addOrg}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-[16px] border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-surface transition-all cursor-pointer text-[14px] font-semibold"
              >
                <Plus className="w-4 h-4" aria-hidden />
                {t('settings.ad.addOrg')}
              </button>
            </section>

            {/* Синхронизация */}
            <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
              <h3 className="text-[13px] font-bold text-muted-foreground uppercase">
                {t('settings.ad.lastSyncTitle')}
              </h3>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] font-semibold text-foreground">{t('settings.ad.syncInterval')}</span>
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

              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={testMode || syncRunning}
                className={primaryButton(testMode || syncRunning, 'w-full py-2.5 mt-1 text-[14px]')}
              >
                {syncRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="w-4 h-4" aria-hidden />
                )}
                {syncRunning ? t('sync.running') : t('sync.now')}
              </button>
            </section>

            {/* Уборка дубликатов учёток */}
            <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
              <h3 className="text-[13px] font-bold text-muted-foreground uppercase">
                {t('settings.ad.duplicatesTitle')}
              </h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">{t('settings.ad.duplicatesDesc')}</p>
              <button
                type="button"
                onClick={() => void handleDuplicatesCheck()}
                disabled={dupBusy !== null || testMode}
                className={primaryButton(dupBusy !== null || testMode, 'w-full py-2.5 text-[14px]')}
              >
                {dupBusy === 'preview' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                ) : (
                  <UsersRound className="w-4 h-4" aria-hidden />
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
          <p className="text-[13px] text-blue-500 leading-relaxed font-medium">{t('adSettingsInfo')}</p>
        </div>
      </div>

      {removingOrg !== null && (
        <div
          className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="bg-surface w-full max-w-[360px] rounded-[24px] p-6 shadow-2xl border border-border flex flex-col gap-4 text-center">
            <h3 className="text-[20px] font-bold text-foreground">{t('settings.ad.removeOrg')}</h3>
            <p className="text-[15px] text-muted-foreground leading-relaxed">
              {t('settings.ad.removeConfirm', { org: configs[removingOrg]?.organization ?? '' })}
            </p>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={() => setRemovingOrg(null)}
                className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-foreground/70 hover:bg-input transition-all border border-border bg-surface cursor-pointer"
              >
                {t('action.cancelBtn')}
              </button>
              <button
                type="button"
                onClick={() => void removeOrg(removingOrg)}
                className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-white bg-red-500 hover:bg-red-600 transition-all cursor-pointer"
              >
                {t('settings.ad.removeOrg')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SyncMetaLine({
  organization,
  syncStates,
  locale,
}: {
  organization: string;
  syncStates: { organization: string; lastSyncAt: number | null; lastCount: number | null; lastError: string | null }[];
  locale: string;
}) {
  const { t } = useTranslation();
  const meta = syncStates.find((state) => state.organization === organization);
  if (!organization || !meta) {
    return null;
  }

  if (meta.lastError) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-red-500 font-medium min-w-0" title={meta.lastError}>
        <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="truncate">{meta.lastError}</span>
      </span>
    );
  }
  if (meta.lastSyncAt) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-medium">
        {t('sync.lastSync', { time: formatRelativeTime(meta.lastSyncAt, locale) })}
        {meta.lastCount !== null && ` · ${t('sync.records', { count: meta.lastCount })}`}
      </span>
    );
  }
  return <span className="text-[12px] text-muted-foreground font-medium">{t('sync.never')}</span>;
}
