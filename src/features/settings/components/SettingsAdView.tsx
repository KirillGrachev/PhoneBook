import { useMemo, useState } from 'react';
import { Monitor, Plus } from '@/components/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError, isTauri } from '@/api/backend';
import { configApi, contactsApi, syncApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import type { DuplicatesPreviewDto, LdapOrgConfigDto } from '@/api/contracts';
import { Switch } from '@/components/ui/Switch';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { translateBackendError } from '@/lib/errors';
import { personNameForLanguage } from '@/lib/transliteration';
import { useAppStore } from '@/store/useAppStore';

import { toInput } from './settingsAdUtils';
import { SettingsAdDuplicates } from './SettingsAdDuplicates';
import { SettingsAdOrgCard } from './SettingsAdOrgCard';
import { SettingsAdRemoveDialog } from './SettingsAdRemoveDialog';
import { SettingsAdSyncCard } from './SettingsAdSyncCard';

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

/**
 * Active Directory settings.
 *
 * * several organizations, each with its own controller, Base DN and account;
 * * the password goes through a separate command straight into the keyring, bypassing the store and config.json;
 * * "Test connection" — diagnostics through the backend (bind + rootDSE + sample);
 * * manual sync launch and the last-sync status per organization;
 * * in the browser (without Tauri) the form is hidden: AD is unavailable outside the desktop app.
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

  /** Entered (not yet saved) passwords: organization → password. */
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
    // The open card may belong to the removed organization; clear it so the
    // detail pane does not flash a load error before the next sync refreshes.
    useAppStore.setState({ selectedId: null });
    if (desktop && removed.organization && removed.hasPassword) {
      try {
        await configApi.setPassword(removed.organization, null);
      } catch (error) {
        console.warn('[ad-settings] не удалось удалить секрет', error);
      }
    }
  };

  const testOrg = async (index: number) => {
    if (testingOrg !== null) {
      return;
    }
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
              names:
                result.sampleNames.map((name) => personNameForLanguage(name, i18n.language)).join(', ') +
                (result.sampleIsTruncated ? ` ${t('settings.ad.testMore')}` : ''),
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

      // rootDSE hint: if Base DN is empty — we suggest the domain root.
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

  /** Duplicate preview: empty — a toast, otherwise a confirmation dialog. */
  const handleDuplicatesCheck = async () => {
    if (dupBusy !== null) {
      return;
    }
    setDupBusy('preview');
    try {
      const preview = await contactsApi.previewDuplicates();
      devLog('dedup', { preview });
      if (preview.groups === 0) {
        toast.success(t('settings.ad.duplicatesNone'), { id: 'dedup-result' });
      } else {
        setDupPreview(preview);
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'dedup-error' });
    } finally {
      setDupBusy(null);
    }
  };

  /** Duplicate cleanup with invalidation of directory results. */
  const handleDuplicatesApply = async () => {
    if (dupBusy !== null) {
      return;
    }
    setDupBusy('apply');
    try {
      const removed = await contactsApi.deduplicate();
      devLog('dedup', { removed });
      toast.success(t('settings.ad.duplicatesDone', { count: removed }), { id: 'dedup-result' });
      setDupPreview(null);
      // A selected card may point at a removed duplicate. Clear it before the
      // next directory render, otherwise the detail pane flashes a load error.
      useAppStore.setState({ selectedId: null });
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
        {/* Test mode - available everywhere (in the browser it enables demo data) */}
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
            {/* Organizations */}
            <section className="flex flex-col gap-4" aria-label={t('settings.adSettings')}>
              {configs.map((config, index) => (
                <SettingsAdOrgCard
                  key={index}
                  config={config}
                  index={index}
                  passwordDraft={passwordDrafts[config.organization] ?? ''}
                  testing={testingOrg === index}
                  busy={testingOrg !== null && testingOrg !== index}
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

            <SettingsAdSyncCard
              syncIntervalHours={syncIntervalHours}
              onSyncIntervalChange={setSyncIntervalHours}
              connectTimeoutSecs={ldapConnectTimeoutSecs}
              onConnectTimeoutChange={setLdapConnectTimeoutSecs}
              operationTimeoutSecs={ldapOperationTimeoutSecs}
              onOperationTimeoutChange={setLdapOperationTimeoutSecs}
              testMode={testMode}
              syncRunning={syncRunning}
              onSyncNow={() => void syncNow()}
            />

            <SettingsAdDuplicates
              testMode={testMode}
              busy={dupBusy}
              preview={dupPreview}
              onCheck={() => void handleDuplicatesCheck()}
              onApply={() => void handleDuplicatesApply()}
              onClose={() => setDupPreview(null)}
            />
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
