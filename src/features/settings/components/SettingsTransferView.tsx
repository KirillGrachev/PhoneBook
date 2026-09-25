import { useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileDown, FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { isTauri } from '@/api/backend';
import { configApi } from '@/api/directory';
import type { AppConfigDto } from '@/api/contracts';
import { DIRECTORY_QUERY_KEYS } from '@/hooks/useSyncStatus';
import { buildConfigPatch, parseConfigFileContent, renderConfigFile } from '@/lib/configExchange';
import { translateBackendError } from '@/lib/errors';
import { flushConfigSave } from '@/store/configStorage';
import { useAppStore } from '@/store/useAppStore';

import { ACTION_BUTTON_CLASS } from './settingsStyles';

/**
 * Страница «Перенос конфигурации»: файл обмена настройками между ПК.
 * Отдельный экран, чтобы главный раздел настроек не превращался
 * в прокручиваемую страницу со всеми группами подряд.
 *
 * Заголовок экрана рендерится общей шапкой SettingsHeader, поэтому
 * внутри раздела своего заголовка нет — повторять название страницы
 * вторым рядком означало бы дублировать уже сказанное.
 */
export function SettingsTransferView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [transferBusy, setTransferBusy] = useState<'export' | 'import' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Кэши справочника устаревают после импорта конфигурации. */
  const invalidateDirectory = () => {
    for (const key of DIRECTORY_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  const handleExportConfig = async () => {
    setTransferBusy('export');
    try {
      // Дебаунс сохранения сбрасываем: в файл должны попасть последние правки.
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
          syncIntervalHours: state.syncIntervalHours,
          hideEmptyContacts: state.hideEmptyContacts,
          emailOverrides: state.emailOverrides,
          orgGroups: state.orgGroups,
          enterpriseGroupId: state.enterpriseGroupId,
          externalPhonebookPath: state.externalPhonebookPath,
          externalPhonebookEnabled: state.externalPhonebookEnabled,
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExportConfig()}
            disabled={transferBusy !== null}
            className={ACTION_BUTTON_CLASS}
          >
            <FileDown className="w-4 h-4" aria-hidden />
            {t('settings.transferExport')}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={transferBusy !== null}
            className={ACTION_BUTTON_CLASS}
          >
            <FileUp className="w-4 h-4" aria-hidden />
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
