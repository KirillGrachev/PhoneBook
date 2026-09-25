import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';
import { useAppStore, type ThemeName } from '@/store/useAppStore';

import { SECTION_HEADING_CLASS, SWITCH_ROW_CLASS } from './settingsStyles';

const THEME_OPTIONS: { value: ThemeName; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'themeLight' },
  { value: 'dark', icon: Moon, labelKey: 'themeDark' },
  { value: 'system', icon: Monitor, labelKey: 'themeSystem' },
];

/**
 * Страница «Интерфейс и поиск»: оформление, язык, анимации и параметры
 * поиска. Вынесена с главного экрана настроек, чтобы главный экран остался
 * навигацией, а не прокручиваемой свалкой всех групп подряд.
 */
export function SettingsInterfaceView() {
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

  return (
    <div className="flex flex-col gap-5 w-full pb-4">
      <section className="space-y-2.5" aria-labelledby="appearance-heading">
        <h4 id="appearance-heading" className={SECTION_HEADING_CLASS}>
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
        <h4 id="language-heading" className={SECTION_HEADING_CLASS}>
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
        <h4 id="animations-heading" className={SECTION_HEADING_CLASS}>
          {t('animations')}
        </h4>
        <div className={SWITCH_ROW_CLASS}>
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-[15px] font-bold text-foreground">{t('enableAnimations')}</span>
            <span className="text-[13px] text-muted-foreground leading-snug">{t('enableAnimationsDesc')}</span>
          </div>
          <Switch checked={animationsEnabled} onChange={setAnimationsEnabled} ariaLabel={t('enableAnimations')} />
        </div>
      </section>

      <section className="space-y-2.5" aria-labelledby="search-params-heading">
        <h4 id="search-params-heading" className={SECTION_HEADING_CLASS}>
          {t('settings.searchParams')}
        </h4>
        <div className={SWITCH_ROW_CLASS}>
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-[15px] font-bold text-foreground">{t('globalMode')}</span>
            <span className="text-[13px] text-muted-foreground leading-snug">{t('globalModeDesc')}</span>
          </div>
          <Switch checked={globalMode} onChange={setGlobalMode} ariaLabel={t('globalMode')} />
        </div>

        <div className={SWITCH_ROW_CLASS}>
          <div className="flex flex-col gap-0.5 pr-4">
            <span className="text-[15px] font-bold text-foreground">{t('settings.hideEmpty')}</span>
            <span className="text-[13px] text-muted-foreground leading-snug">{t('settings.hideEmptyDesc')}</span>
          </div>
          <Switch checked={hideEmptyContacts} onChange={setHideEmptyContacts} ariaLabel={t('settings.hideEmpty')} />
        </div>
      </section>
    </div>
  );
}
