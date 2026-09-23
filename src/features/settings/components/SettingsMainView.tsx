import { ChevronRight, Info, Layers, Monitor, Moon, Settings as SettingsIcon, Sun, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/components/ui/Switch';
import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';
import { cn } from '@/lib/utils';
import { useAppStore, type ThemeName } from '@/store/useAppStore';

import type { SettingsView } from '../SettingsPage';

interface SettingsMainViewProps {
  onNavigate: (view: SettingsView) => void;
}

const THEME_OPTIONS: { value: ThemeName; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' },
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
];

const NAV_ITEM_CLASS =
  'group w-full flex items-center justify-between border border-border bg-surface hover:bg-surface-hover active:translate-y-[1px] outline-none px-4 py-2.5 rounded-[16px] transition-all duration-300 shadow-sm cursor-pointer';

/** Основной раздел настроек: оформление, язык, анимации, параметры поиска. */
export function SettingsMainView({ onNavigate }: SettingsMainViewProps) {
  const { t } = useTranslation();

  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const globalMode = useAppStore((state) => state.globalMode);
  const setGlobalMode = useAppStore((state) => state.setGlobalMode);
  const hideEmptyContacts = useAppStore((state) => state.hideEmptyContacts);
  const setHideEmptyContacts = useAppStore((state) => state.setHideEmptyContacts);
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);
  const setAnimationsEnabled = useAppStore((state) => state.setAnimationsEnabled);

  const showDevtools = import.meta.env.DEV && isTauri();

  const handleOpenDevtools = async () => {
    try {
      await systemApi.openDevtools();
    } catch (error) {
      console.error('[settings] devtools unavailable', error);
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex flex-col gap-4">
        <section className="space-y-2.5" aria-labelledby="appearance-heading">
          <h4 id="appearance-heading" className="text-[13px] font-bold text-muted-foreground pl-1 uppercase">
            {t('appearance')}
          </h4>
          <div
            className="bg-input rounded-[16px] p-1.5 flex relative overflow-hidden"
            role="radiogroup"
            aria-label={t('appearance')}
          >
            {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-[12px] text-[13px] transition-all outline-none mx-0.5 cursor-pointer',
                  theme === value
                    ? 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-zinc-700 dark:text-white font-semibold'
                    : 'text-foreground/70 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                <Icon className="w-4 h-4" aria-hidden />
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2.5" aria-labelledby="language-heading">
          <h4 id="language-heading" className="text-[13px] font-bold text-muted-foreground pl-1 uppercase">
            {t('language')}
          </h4>
          <div className="bg-input rounded-[16px] p-1.5 flex" role="radiogroup" aria-label={t('language')}>
            {(['ru', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={language === code}
                onClick={() => setLanguage(code)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-[12px] text-[14px] transition-all outline-none mx-0.5 font-medium cursor-pointer',
                  language === code
                    ? 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-zinc-700 dark:text-white'
                    : 'text-foreground/80 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10',
                )}
              >
                <span>{code === 'ru' ? t('langRu') : t('langEn')}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2.5" aria-labelledby="animations-heading">
          <h4 id="animations-heading" className="text-[13px] font-bold text-muted-foreground pl-1 uppercase">
            {t('animations')}
          </h4>
          <div className="flex items-center justify-between border border-border bg-surface p-3.5 rounded-[16px] shadow-sm">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-[15px] font-bold text-foreground">{t('enableAnimations')}</span>
              <span className="text-[13px] text-muted-foreground leading-snug">{t('enableAnimationsDesc')}</span>
            </div>
            <Switch checked={animationsEnabled} onChange={setAnimationsEnabled} ariaLabel={t('enableAnimations')} />
          </div>
        </section>

        <section className="space-y-2.5" aria-labelledby="search-params-heading">
          <h4 id="search-params-heading" className="text-[13px] font-bold text-muted-foreground pl-1 uppercase">
            {t('settings.searchParams')}
          </h4>
          <div className="flex items-center justify-between border border-border bg-surface p-3.5 rounded-[16px] shadow-sm">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-[15px] font-bold text-foreground">{t('globalMode')}</span>
              <span className="text-[13px] text-muted-foreground leading-snug">{t('globalModeDesc')}</span>
            </div>
            <Switch checked={globalMode} onChange={setGlobalMode} ariaLabel={t('globalMode')} />
          </div>

          <div className="flex items-center justify-between border border-border bg-surface p-3.5 rounded-[16px] shadow-sm">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-[15px] font-bold text-foreground">{t('settings.hideEmpty')}</span>
              <span className="text-[13px] text-muted-foreground leading-snug">{t('settings.hideEmptyDesc')}</span>
            </div>
            <Switch checked={hideEmptyContacts} onChange={setHideEmptyContacts} ariaLabel={t('settings.hideEmpty')} />
          </div>
        </section>

        <nav className="pt-1 pb-4 flex flex-col gap-3" aria-label={t('settings')}>
          <button type="button" onClick={() => onNavigate('ad')} className={NAV_ITEM_CLASS}>
            <span className="flex items-center gap-3 text-foreground">
              <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                <SettingsIcon className="w-[18px] h-[18px]" aria-hidden />
              </span>
              <span className="font-bold text-[16px]">{t('settings.adSettings')}</span>
            </span>
            <ChevronRight
              className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
              aria-hidden
            />
          </button>

          <button type="button" onClick={() => onNavigate('groups')} className={NAV_ITEM_CLASS}>
            <span className="flex items-center gap-3 text-foreground">
              <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-sky-500/10 flex items-center justify-center text-sky-500 shrink-0">
                <Layers className="w-[18px] h-[18px]" aria-hidden />
              </span>
              <span className="font-bold text-[16px]">{t('settings.orgGroups')}</span>
            </span>
            <ChevronRight
              className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
              aria-hidden
            />
          </button>

          {showDevtools && (
            <button type="button" onClick={() => void handleOpenDevtools()} className={NAV_ITEM_CLASS}>
              <span className="flex items-center gap-3 text-foreground">
                <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
                  <Terminal className="w-[18px] h-[18px]" aria-hidden />
                </span>
                <span className="font-bold text-[16px]">{t('devConsole')}</span>
              </span>
              <ChevronRight
                className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
                aria-hidden
              />
            </button>
          )}

          <button type="button" onClick={() => onNavigate('about')} className={NAV_ITEM_CLASS}>
            <span className="flex items-center gap-3 text-foreground">
              <span className="w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Info className="w-[18px] h-[18px]" aria-hidden />
              </span>
              <span className="font-bold text-[16px]">{t('aboutApp')}</span>
            </span>
            <ChevronRight
              className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
              aria-hidden
            />
          </button>
        </nav>
      </div>
    </div>
  );
}
