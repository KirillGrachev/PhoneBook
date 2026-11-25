import { useEffect } from 'react';

/** Applies the theme (the `dark` class on <html>) with a smooth transition. */
export function useThemeApplier(theme: string): void {
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    root.classList.add('theme-transitioning');
    root.classList.toggle('dark', isDark);

    const timeout = setTimeout(() => root.classList.remove('theme-transitioning'), 500);

    // In the system theme we react to OS preference changes without a restart.
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
