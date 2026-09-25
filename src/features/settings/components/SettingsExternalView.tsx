import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderOpen, RefreshCw } from 'lucide-react';
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
 * Страница «Внешний телефонный файл»: выгрузка Yealink IPPhoneBook (XML)
 * в справочник. Отдельный экран настроек вместо секции на главном.
 *
 * Тумблер — единственный рубильник функции: пока он выключен, файл не
 * читается, его записи убраны из кэша, а кнопки выбора и загрузки неактивны
 * (backend на каждом обновлении вызывает очистку внешних записей). При
 * включении загрузка выполняется сразу и повторяется планировщиком
 * синхронизации; «Загрузить сейчас» перечитывает файл вручную.
 *
 * Если путь к файлу в конфигурации не задан, переключение тумблера только
 * сохраняет настройку и НЕ отправляет запрос обновления на бэкенд —
 * загружать нечего, а мигание заблокированных кнопок на каждом щелчке
 * было бы чистым шумом. При заданном пути перезагрузка выполняется
 * в фоне, результат приходит тостом.
 */
export function SettingsExternalView() {
  const { t } = useTranslation();

  const externalPhonebookPath = useAppStore((state) => state.externalPhonebookPath);
  const setExternalPhonebookPath = useAppStore((state) => state.setExternalPhonebookPath);
  const externalPhonebookEnabled = useAppStore((state) => state.externalPhonebookEnabled);
  const setExternalPhonebookEnabled = useAppStore((state) => state.setExternalPhonebookEnabled);

  const queryClient = useQueryClient();
  /** Блокировка с индикатором — только для явных действий (кнопки), не для тумблера. */
  const [externalBusy, setExternalBusy] = useState(false);
  /** Защита от параллельных перезагрузок: тумблер и кнопки не должны пересекаться. */
  const refreshInFlight = useRef(false);

  /** Кэши справочника устаревают после загрузки внешнего телефонного файла. */
  const invalidateDirectory = () => {
    for (const key of DIRECTORY_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  /**
   * Перечитать внешний файл по сохранённой конфигурации и обновить выдачу.
   *
   * `busy` — показывать спиннер и блокировать кнопки: верно только для
   * явных действий пользователя. Фоновые вызовы (тумблер) проходят без
   * визуальной блокировки, поэтому переключение ничего не «мигает».
   */
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
        toast.success(t('settings.externalLoaded', { count: result.count ?? 0, org: result.organization ?? '' }));
      } else if (result.state === 'cleared') {
        toast.success(t('settings.externalCleared', { count: result.cleared ?? 0 }));
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

  /** Тумблер: сохраняем настройку; загрузка — только если загружать есть чего. */
  const handleEnabledToggle = (checked: boolean) => {
    setExternalPhonebookEnabled(checked);
    flushConfigSave();
    if (checked && !useAppStore.getState().externalPhonebookPath) {
      return; // файла нет: запрос бессмыслен, подсказка уже в карточке
    }
    void runRefresh(false);
  };

  const handlePickExternalFile = async () => {
    try {
      const path = await configApi.pickExternalPhonebookFile();
      if (!path) {
        return; // диалог закрыт — не ошибка
      }
      setExternalPhonebookPath(path);
      flushConfigSave();
      // Защита избыточна по UI (кнопка при выключенном тумблере неактивна),
      // но оставляет обработчик корректным при любом состоянии магазина.
      if (useAppStore.getState().externalPhonebookEnabled) {
        void runRefresh(true);
      }
    } catch (error) {
      toast.error(translateBackendError(error, t), { id: 'external-pick-error' });
    }
  };

  const handleLoadNow = () => {
    flushConfigSave();
    void runRefresh(true);
  };

  /** Без файла или при выключенном тумблере загрузка невозможна: кнопка гаснет
   *  сразу, а не «мигает» запросом, который заведомо ничего не сделает. */
  const loadNowDisabled = externalBusy || !externalPhonebookEnabled || externalPhonebookPath === null;
  /** Выбор файла — часть функции: при выключенном тумблере он не нужен,
   *  поэтому карточка файла целиком гаснет вместе с рубильником. */
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
          <span
            className={cn(
              'text-[13px] break-all leading-snug',
              externalPhonebookEnabled ? 'text-muted-foreground' : 'text-muted-foreground/60',
            )}
          >
            {externalPhonebookPath ?? t('settings.externalNotSelected')}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handlePickExternalFile()}
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
          {/* Подсказка под карточкой файла объясняет текущее состояние рубильника:
              пользователь не должен гадать, почему кнопки неактивны. */}
          {externalPhonebookEnabled && externalPhonebookPath === null && (
            <p className="text-[13px] text-amber-500 leading-snug">{t('settings.externalHintNeedFile')}</p>
          )}
          {!externalPhonebookEnabled && externalPhonebookPath === null && (
            <p className="text-[13px] text-muted-foreground leading-snug">{t('settings.externalHintOff')}</p>
          )}
          {!externalPhonebookEnabled && externalPhonebookPath !== null && (
            <p className="text-[13px] text-muted-foreground leading-snug">{t('settings.externalHintDisabled')}</p>
          )}
        </div>
      </section>
    </div>
  );
}
