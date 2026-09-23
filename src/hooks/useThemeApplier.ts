import { useEffect } from 'react';

/** Применяет тему (class `dark` на <html>) с плавным переходом. */
export function useThemeApplier(theme: string): void {
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    root.classList.add('theme-transitioning');
    root.classList.toggle('dark', isDark);

    const timeout = setTimeout(() => root.classList.remove('theme-transitioning'), 500);

    // В системной теме реагируем на смену предпочтений ОС без перезапуска.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = (event: MediaQueryListEvent) => {
      if (theme === 'system') {
        root.classList.toggle('dark', event.matches);
      }
    };
    media.addEventListener('change', onSystemThemeChange);

    return () => {
      clearTimeout(timeout);
      media.removeEventListener('change', onSystemThemeChange);
    };
  }, [theme]);
}
