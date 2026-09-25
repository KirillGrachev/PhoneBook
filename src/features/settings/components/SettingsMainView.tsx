import {
  ArrowLeftRight,
  ChevronRight,
  FileStack,
  Info,
  Layers,
  Palette,
  Settings as SettingsIcon,
  Terminal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';
import { cn } from '@/lib/utils';

import { NAV_ITEM_CLASS } from './settingsStyles';

import type { SettingsView } from '../SettingsPage';

interface SettingsMainViewProps {
  onNavigate: (view: SettingsView) => void;
}

interface NavRow {
  view: SettingsView;
  icon: typeof Info;
  tint: string;
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
  const showDevtools = import.meta.env.DEV && isTauri();

  const rows: NavRow[] = [
    {
      view: 'interface',
      icon: Palette,
      tint: 'bg-violet-500/10 text-violet-500',
      labelKey: 'settings.interfaceTitle',
    },
    ...(isTauri()
      ? [
          {
            view: 'external',
            icon: FileStack,
            tint: 'bg-emerald-500/10 text-emerald-500',
            labelKey: 'settings.externalTitle',
          } satisfies NavRow,
        ]
      : []),
    {
      view: 'transfer',
      icon: ArrowLeftRight,
      tint: 'bg-teal-500/10 text-teal-500',
      labelKey: 'settings.transferTitle',
    },
    {
      view: 'ad',
      icon: SettingsIcon,
      tint: 'bg-amber-500/10 text-amber-500',
      labelKey: 'settings.adSettings',
    },
    {
      view: 'groups',
      icon: Layers,
      tint: 'bg-sky-500/10 text-sky-500',
      labelKey: 'settings.orgGroups',
    },
  ];

  const handleOpenDevtools = async () => {
    try {
      await systemApi.openDevtools();
    } catch (error) {
      console.error('[settings] devtools unavailable', error);
    }
  };

  const chevron = (
    <ChevronRight
      className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
      aria-hidden
    />
  );

  return (
    <nav className="flex flex-col gap-3 pb-4" aria-label={t('settings')}>
      {rows.map(({ view, icon: Icon, tint, labelKey }) => (
        <button key={view} type="button" onClick={() => onNavigate(view)} className={NAV_ITEM_CLASS}>
          <span className="flex items-center gap-3 text-foreground">
            <span
              className={cn(
                'w-9 h-9 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center shrink-0',
                tint,
              )}
            >
              <Icon className="w-[18px] h-[18px]" aria-hidden />
            </span>
            <span className="font-bold text-[16px]">{t(labelKey)}</span>
          </span>
          {chevron}
        </button>
      ))}

      {showDevtools && (
        <button type="button" onClick={() => void handleOpenDevtools()} className={NAV_ITEM_CLASS}>
          <span className="flex items-center gap-3 text-foreground">
            <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
              <Terminal className="w-[18px] h-[18px]" aria-hidden />
            </span>
            <span className="font-bold text-[16px]">{t('devConsole')}</span>
          </span>
          {chevron}
        </button>
      )}

      <button type="button" onClick={() => onNavigate('about')} className={NAV_ITEM_CLASS}>
        <span className="flex items-center gap-3 text-foreground">
          <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Info className="w-[18px] h-[18px]" aria-hidden />
          </span>
          <span className="font-bold text-[16px]">{t('aboutApp')}</span>
        </span>
        {chevron}
      </button>
    </nav>
  );
}
