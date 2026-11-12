import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, RefreshCw, X } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/Switch';
import { configApi } from '@/api/directory';
import { DIRECTORY_QUERY_KEYS } from '@/hooks/useSyncStatus';
import { translateBackendError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { flushConfigSave } from '@/store/configStorage';
import { useAppStore } from '@/store/useAppStore';

import { ACTION_BUTTON_CLASS, SWITCH_ROW_CLASS } from './settingsStyles';

/**
 * External phone book files (Yealink IPPhoneBook XML). Every selected file is
 * imported as a separate directory source, so multiple exports can be used at
 * the same time.
 *
 * The toggle is the feature's master switch: while it is off, files are not
 * read and their entries are removed from search. "Load now" re-reads all
 * selected files; adding or removing a file refreshes the directory when the
 * feature is enabled.
 */
export function SettingsExternalView() {
  const { t } = useTranslation();

  const externalPhonebookPaths = useAppStore((state) => state.externalPhonebookPaths);
  const setExternalPhonebookPaths = useAppStore((state) => state.setExternalPhonebookPaths);
  const externalPhonebookEnabled = useAppStore((state) => state.externalPhonebookEnabled);
  const setExternalPhonebookEnabled = useAppStore((state) => state.setExternalPhonebookEnabled);

  const queryClient = useQueryClient();
  const [externalBusy, setExternalBusy] = useState(false);
  const refreshInFlight = useRef(false);

  const invalidateDirectory = () => {
    for (const key of DIRECTORY_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  const runRefresh = async (busy: boolean) => {
    if (refreshInFlight.current) {
      return;
    }
    refreshInFlight.current = true;
    if (busy) {
      setExternalBusy(true);
    }
    try {
      const result = await configApi.refreshExternalPhonebook();
      invalidateDirectory();
      if (result.state === 'loaded') {
        const organizations = result.sources?.map((source) => source.organization).join(', ') ?? '';
        toast.success(
          t('settings.externalLoaded', {
            count: result.count ?? 0,
            files: result.sources?.length ?? 0,
            org: organizations,
          }),
        );
      } else if (result.state === 'cleared') {
        toast.success(t('settings.externalCleared', { count: result.cleared ?? 0 }));
      } else if (result.state === 'cached') {
        toast.warning(t('settings.externalCached', { count: result.count ?? 0 }));
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'external-refresh-error' });
    } finally {
      refreshInFlight.current = false;
      if (busy) {
        setExternalBusy(false);
      }
    }
  };

  const handleEnabledToggle = (checked: boolean) => {
    setExternalPhonebookEnabled(checked);
    void (async () => {
      await flushConfigSave();
      if (checked && externalPhonebookPaths.length === 0) {
        return;
      }
      await runRefresh(false);
    })();
  };

  const handlePickExternalFiles = async () => {
    try {
      const selected = await configApi.pickExternalPhonebookFiles();
      if (selected.length === 0) {
        return;
      }
      const merged = [...externalPhonebookPaths];
      for (const path of selected) {
        if (!merged.some((existing) => existing.toLowerCase() === path.toLowerCase())) {
          merged.push(path);
        }
      }
      setExternalPhonebookPaths(merged);
      await flushConfigSave();
      if (useAppStore.getState().externalPhonebookEnabled) {
        await runRefresh(true);
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'external-pick-error' });
    }
  };

  const handleRemove = (path: string) => {
    const next = externalPhonebookPaths.filter((existing) => existing !== path);
    setExternalPhonebookPaths(next);
    void (async () => {
      await flushConfigSave();
      if (useAppStore.getState().externalPhonebookEnabled) {
        // With no paths left this clears the external sources.
        await runRefresh(true);
      }
    })();
  };

  const handleLoadNow = () => {
    void (async () => {
      await flushConfigSave();
      await runRefresh(true);
    })();
  };

  const hasFiles = externalPhonebookPaths.length > 0;
  const loadNowDisabled = externalBusy || !externalPhonebookEnabled || !hasFiles;
  const pickDisabled = externalBusy || !externalPhonebookEnabled;

  return (
    <div className="flex flex-col gap-5 w-full pb-4">
      <section className="space-y-2.5">
        <p className="text-[13px] text-muted-foreground leading-snug px-1">{t('settings.externalDesc')}</p>

        <div className={SWITCH_ROW_CLASS}>
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-[15px] font-bold text-foreground">{t('settings.externalEnabled')}</span>
          </div>
          <Switch
            checked={externalPhonebookEnabled}
            onChange={handleEnabledToggle}
            ariaLabel={t('settings.externalEnabled')}
          />
        </div>

        <div className="border border-border bg-surface p-3.5 rounded-[16px] shadow-sm flex flex-col gap-2.5">
          {hasFiles ? (
            <ul className="flex flex-col gap-1.5">
              {externalPhonebookPaths.map((path) => (
                <li key={path} className="flex items-start gap-2 min-w-0">
                  <span
                    className={cn(
                      'text-[13px] break-all leading-snug flex-1',
                      externalPhonebookEnabled ? 'text-muted-foreground' : 'text-muted-foreground/60',
                    )}
                  >
                    {path}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(path)}
                    className="shrink-0 mt-0.5 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors no-ring"
                    aria-label={t('settings.externalRemove')}
                  >
                    <X className="w-4 h-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[13px] leading-snug text-muted-foreground/60">
              {t('settings.externalNotSelected')}
            </span>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handlePickExternalFiles()}
              disabled={pickDisabled}
              className={ACTION_BUTTON_CLASS}
            >
              <FolderOpen className="w-4 h-4" aria-hidden />
              {t('settings.externalChoose')}
            </button>
            <button type="button" onClick={handleLoadNow} disabled={loadNowDisabled} className={ACTION_BUTTON_CLASS}>
              <RefreshCw className={cn('w-4 h-4', externalBusy && 'animate-spin')} aria-hidden />
              {t('settings.externalLoadNow')}
            </button>
          </div>

          {externalPhonebookEnabled && !hasFiles && (
            <p className="text-[13px] text-amber-500 leading-snug">{t('settings.externalHintNeedFile')}</p>
          )}
          {!externalPhonebookEnabled && !hasFiles && (
            <p className="text-[13px] text-muted-foreground leading-snug">{t('settings.externalHintOff')}</p>
          )}
          {!externalPhonebookEnabled && hasFiles && (
            <p className="text-[13px] text-muted-foreground leading-snug">{t('settings.externalHintDisabled')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
