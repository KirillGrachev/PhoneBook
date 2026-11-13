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
 * ÐÐ°ÑÑ‚Ñ€Ð¾Ð¹ÐºÐ¸ Active Directory.
 *
 * * Ð½ÐµÑÐºÐ¾Ð»ÑŒÐºÐ¾ Ð¾Ñ€Ð³Ð°Ð½Ð¸Ð·Ð°Ñ†Ð¸Ð¹, ÐºÐ°Ð¶Ð´Ð°Ñ ÑÐ¾ ÑÐ²Ð¾Ð¸Ð¼ ÐºÐ¾Ð½Ñ‚Ñ€Ð¾Ð»Ð»ÐµÑ€Ð¾Ð¼, Base DN Ð¸ ÑƒÑ‡Ñ‘Ñ‚ÐºÐ¾Ð¹;
 * * Ð¿Ð°Ñ€Ð¾Ð»ÑŒ ÑƒÑ…Ð¾Ð´Ð¸Ñ‚ Ð¾Ñ‚Ð´ÐµÐ»ÑŒÐ½Ð¾Ð¹ ÐºÐ¾Ð¼Ð°Ð½Ð´Ð¾Ð¹ straight Ð² keyring, Ð¼Ð¸Ð½ÑƒÑ ÑÑ‚Ð¾Ñ€ Ð¸ config.json;
 * * Â«ÐŸÑ€Ð¾Ð²ÐµÑ€Ð¸Ñ‚ÑŒ Ð¿Ð¾Ð´ÐºÐ»ÑŽÑ‡ÐµÐ½Ð¸ÐµÂ» â€” Ð´Ð¸Ð°Ð³Ð½Ð¾ÑÑ‚Ð¸ÐºÐ° Ñ‡ÐµÑ€ÐµÐ· Ð±ÑÐºÐµÐ½Ð´ (bind + rootDSE + Ð²Ñ‹Ð±Ð¾Ñ€ÐºÐ°);
 * * Ñ€ÑƒÑ‡Ð½Ð¾Ð¹ Ð·Ð°Ð¿ÑƒÑÐº ÑÐ¸Ð½Ñ…Ñ€Ð¾Ð½Ð¸Ð·Ð°Ñ†Ð¸Ð¸ Ð¸ ÑÑ‚Ð°Ñ‚ÑƒÑ Ð¿Ð¾ÑÐ»ÐµÐ´Ð½ÐµÐ¹ Ð¿Ð¾ ÐºÐ°Ð¶Ð´Ð¾Ð¹ Ð¾Ñ€Ð³Ð°Ð½Ð¸Ð·Ð°Ñ†Ð¸Ð¸;
 * * Ð² Ð±Ñ€Ð°ÑƒÐ·ÐµÑ€Ðµ (Ð±ÐµÐ· Tauri) Ñ„Ð¾Ñ€Ð¼Ð° ÑÐºÑ€Ñ‹Ñ‚Ð°: AD Ð½ÐµÐ´Ð¾ÑÑ‚ÑƒÐ¿ÐµÐ½ Ð²Ð½Ðµ Ð´ÐµÑÐºÑ‚Ð¾Ð¿-Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ñ.
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

  /** Ð’Ð²ÐµÐ´Ñ‘Ð½Ð½Ñ‹Ðµ (ÐµÑ‰Ñ‘ Ð½Ðµ ÑÐ¾Ñ…Ñ€Ð°Ð½Ñ‘Ð½Ð½Ñ‹Ðµ) Ð¿Ð°Ñ€Ð¾Ð»Ð¸: Ð¾Ñ€Ð³Ð°Ð½Ð¸Ð·Ð°Ñ†Ð¸Ñ â†’ Ð¿Ð°Ñ€Ð¾Ð»ÑŒ. */
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
        console.warn('[ad-settings] Ð½Ðµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑƒÐ´Ð°Ð»Ð¸Ñ‚ÑŒ ÑÐµÐºÑ€ÐµÑ‚', error);
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

      // ÐŸÐ¾Ð´ÑÐºÐ°Ð·ÐºÐ° rootDSE: ÐµÑÐ»Ð¸ Base DN Ð¿ÑƒÑÑ‚ â€” Ð¿Ñ€ÐµÐ´Ð»Ð°Ð³Ð°ÐµÐ¼ Ð´Ð¾Ð¼ÐµÐ½Ð½Ñ‹Ð¹ ÐºÐ¾Ñ€ÐµÐ½ÑŒ.
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

  /** ÐŸÑ€ÐµÐ²ÑŒÑŽ Ð´ÑƒÐ±Ð»Ð¸ÐºÐ°Ñ‚Ð¾Ð²: Ð¿ÑƒÑÑ‚Ð¾ â€” Ñ‚Ð¾ÑÑ‚, Ð¸Ð½Ð°Ñ‡Ðµ Ð¿Ð¾Ð´Ñ‚Ð²ÐµÑ€Ð¶Ð´Ð°ÑŽÑ‰Ð¸Ð¹ Ð´Ð¸Ð°Ð»Ð¾Ð³. */
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

  /** Ð£Ð±Ð¾Ñ€ÐºÐ° Ð´ÑƒÐ±Ð»Ð¸ÐºÐ°Ñ‚Ð¾Ð² Ñ Ð¸Ð½Ð²Ð°Ð»Ð¸Ð´Ð°Ñ†Ð¸ÐµÐ¹ Ð²Ñ‹Ð´Ð°Ñ‡ ÑÐ¿Ñ€Ð°Ð²Ð¾Ñ‡Ð½Ð¸ÐºÐ°. */
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
        {/* Ð¢ÐµÑÑ‚Ð¾Ð²Ñ‹Ð¹ Ñ€ÐµÐ¶Ð¸Ð¼ â€” Ð´Ð¾ÑÑ‚ÑƒÐ¿ÐµÐ½ Ð²ÐµÐ·Ð´Ðµ (Ð² Ð±Ñ€Ð°ÑƒÐ·ÐµÑ€Ðµ Ð²ÐºÐ»ÑŽÑ‡Ð°ÐµÑ‚ Ð´ÐµÐ¼Ð¾-Ð´Ð°Ð½Ð½Ñ‹Ðµ) */}
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
            {/* ÐžÑ€Ð³Ð°Ð½Ð¸Ð·Ð°Ñ†Ð¸Ð¸ */}
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
