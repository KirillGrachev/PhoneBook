import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';

/**
 * Integration with the desktop environment:
 * * shows the window after startup (until then it is hidden so it does not flash
 * a white square until the splash screen is drawn);
 * * keeps the tray menu texts in sync with the current locale.
 *
 * The global hotkey (Ctrl+Shift+Space) is registered on the Rust side;
 * JS is no longer needed for this.
 */
export function useDesktopEnvironment(): void {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let cancelled = false;

    const setup = async () => {
      try {
        const window = getCurrentWindow();
        await window.show();
        await window.setFocus();
      } catch (error) {
        console.warn('[desktop] failed to show window', error);
      }
      try {
        if (!cancelled) {
          await systemApi.updateTrayMenu(t('tray.open'), t('tray.quit'));
        }
      } catch (error) {
        console.warn('[desktop] failed to update tray menu', error);
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [t, i18n.language]);
}
