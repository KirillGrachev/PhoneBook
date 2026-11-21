import { ArrowRight, Terminal } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';
import { useAppStore } from '@/store/useAppStore';

import { NAV_ITEM_CLASS } from './settingsStyles';

import type { SettingsView } from '../SettingsPage';

interface SettingsMainViewProps {
  onNavigate: (view: SettingsView) => void;
}

interface NavRow {
  view: SettingsView;
  labelKey: string;
}

/**
 * Главный экран настроек — только навигация по разделам.
 *
 * Каждая группа настроек живёт на собственной странице («Интерфейс и поиск»,
 * «Внешний телефонный файл», «Перенос конфигурации», AD, группы, о программе):
 * главный экран остаётся коротким списком переходов, а не прокручиваемой
 * страницей со всеми органами управления сразу.
 */
export function SettingsMainView({ onNavigate }: SettingsMainViewProps) {
  const { t } = useTranslation();
  const managed = useAppStore((state) => state.managed);
  const showDevtools = import.meta.env.DEV && isTauri();

  const rows: NavRow[] = [
    {
      view: 'interface',
      labelKey: 'settings.interfaceTitle',
    },
    ...(!managed && isTauri()
      ? [
          {
            view: 'external',
            labelKey: 'settings.externalTitle',
          } satisfies NavRow,
        ]
      : []),
    ...(!managed
      ? [
          {
            view: 'transfer',
            labelKey: 'settings.transferTitle',
          } satisfies NavRow,
          {
            view: 'ad',
            labelKey: 'settings.adSettings',
          } satisfies NavRow,
          {
            view: 'groups',
            labelKey: 'settings.orgGroups',
          } satisfies NavRow,
        ]
      : []),
  ];

  const handleOpenDevtools = async () => {
    try {
      await systemApi.openDevtools();
    } catch (error) {
      console.error('[settings] devtools unavailable', error);
    }
  };

  const chevron = (
    <ArrowRight
      className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
      aria-hidden
    />
  );

  return (
    <nav className="flex flex-col gap-3 pb-4" aria-label={t('settings')}>
      {rows.map(({ view, labelKey }) => (
        <button key={view} type="button" onClick={() => onNavigate(view)} className={NAV_ITEM_CLASS}>
          <span className="font-bold text-[16px] text-foreground">{t(labelKey)}</span>
          {chevron}
        </button>
      ))}

      <button type="button" onClick={() => onNavigate('about')} className={NAV_ITEM_CLASS}>
        <span className="font-bold text-[16px] text-foreground">{t('aboutApp')}</span>
        {chevron}
      </button>

      {showDevtools && !managed && (
        <button type="button" onClick={() => void handleOpenDevtools()} className={NAV_ITEM_CLASS}>
          <span className="flex items-center gap-2.5 text-foreground">
            <Terminal
              className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors"
              aria-hidden
            />
            <span className="font-bold text-[16px]">{t('devConsole')}</span>
          </span>
          {chevron}
        </button>
      )}
    </nav>
  );
}
