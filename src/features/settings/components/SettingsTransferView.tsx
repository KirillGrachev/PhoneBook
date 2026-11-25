import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Export, Import } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { isTauri } from '@/api/backend';
import { configApi } from '@/api/directory';
import type { AppConfigDto } from '@/api/contracts';
import { DIRECTORY_QUERY_KEYS } from '@/hooks/useSyncStatus';
import { buildConfigPatch, parseConfigFileContent, renderConfigFile } from '@/lib/configExchange';
import { translateBackendError } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { flushConfigSave } from '@/store/configStorage';
import { useAppStore } from '@/store/useAppStore';

import { ACTION_BUTTON_CLASS } from './settingsStyles';

const TRANSFER_ACTION_CLASS = cn(ACTION_BUTTON_CLASS, 'h-11 flex-1 min-w-[180px] justify-center px-4 text-[15px]');

/**
 * The "Config transfer" page: an exchange file for settings between PCs.
 * A separate screen so the main settings section does not turn into
 * a scrollable page with all groups in a row.
 *
 * The screen title is rendered by the shared SettingsHeader, so
 * there is no own header inside the section — repeating the page title
 * as a second line would mean duplicating what is already said.
 */
export function SettingsTransferView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Directory caches become stale after a config import. */
  const invalidateDirectory = () => {
    for (const key of DIRECTORY_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  const handleExportConfig = async () => {
    setTransferBusy('export');
    try {
      // We reset the save debounce: the latest edits must land in the file.
      flushConfigSave();
      if (isTauri()) {
        const path = await configApi.exportConfigFile();
        toast.success(t('settings.transferExported'), { description: path });
      } else {
        const state = useAppStore.getState();
        const dto: AppConfigDto = {
          theme: state.theme,
          language: state.language,
          globalMode: state.globalMode,
          savedContactIds: state.savedContactIds,
          ldapConfigs: state.ldapConfigs,
          testMode: state.testMode,
          animationsEnabled: state.animationsEnabled,
          showAvatars: state.showAvatars,
          syncIntervalHours: state.syncIntervalHours,
          ldapConnectTimeoutSecs: state.ldapConnectTimeoutSecs,
          ldapOperationTimeoutSecs: state.ldapOperationTimeoutSecs,
          hideEmptyContacts: state.hideEmptyContacts,
          emailOverrides: state.emailOverrides,
          orgGroups: state.orgGroups,
          enterpriseGroupId: state.enterpriseGroupId,
          externalPhonebookPath: state.externalPhonebookPaths[0] ?? null,
          externalPhonebookPaths: state.externalPhonebookPaths,
          externalPhonebookEnabled: state.externalPhonebookEnabled,
          externalPhonebookIntervals: state.externalPhonebookIntervals,
          externalHideAdDuplicates: state.externalHideAdDuplicates,
          managed: state.managed,
          managedProfile: state.managedProfile,
          managedRevision: state.managedRevision,
        };
        const blob = new Blob([renderConfigFile(buildConfigPatch(dto))], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'kmaruda-config.json';
        link.click();
        URL.revokeObjectURL(url);
        toast.success(t('settings.transferExportedBrowser'));
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'config-export-error' });
    } finally {
      setTransferBusy(null);
    }
  };

  const handleImportConfigPicker = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setTransferBusy('import');
    try {
      const content = await file.text();
      const config = isTauri()
        ? await configApi.parseConfigFile(content)
        : parseConfigFileContent(content, t('settings.transferImportFailed'));
      useAppStore.setState(buildConfigPatch(config));
      flushConfigSave();
      invalidateDirectory();
      toast.success(t('settings.transferImported'), { description: t('settings.transferImportedNote') });
    } catch (error) {
      toast.error(
        error instanceof Error && error.name === 'ConfigFileError' ? error.message : translateBackendError(error, t),
        { id: 'config-import-error' },
      );
    } finally {
      setTransferBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full pb-4">
      <section className="space-y-2.5">
        <p className="text-[13px] text-muted-foreground leading-snug px-1">{t('settings.transferDesc')}</p>
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => void handleExportConfig()}
            disabled={transferBusy !== null}
            className={TRANSFER_ACTION_CLASS}
          >
            <Export className="w-[18px] h-[18px]" aria-hidden />
            {t('settings.transferExport')}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={transferBusy !== null}
            className={TRANSFER_ACTION_CLASS}
          >
            <Import className="w-[18px] h-[18px]" aria-hidden />
            {t('settings.transferImport')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => void handleImportConfigPicker(event)}
          />
        </div>
      </section>
    </div>
  );
}
