import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';

/**
 * Интеграция с десктоп-окружением:
 * * показывает окно после старта (до этого оно скрыто, чтобы не мелькать
 *   белым квадратом до отрисовки splash-экрана);
 * * синхронизирует тексты меню трея с текущей локалью.
 *
 * Глобальная горячая клавиша (Ctrl+Shift+Space) регистрируется на стороне
 * Rust — JS для этого больше не нужен.
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
        console.warn('[desktop] не удалось показать окно', error);
      }
      try {
        if (!cancelled) {
          await systemApi.updateTrayMenu(t('tray.open'), t('tray.quit'));
        }
      } catch (error) {
        console.warn('[desktop] не удалось обновить меню трея', error);
      }
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [t, i18n.language]);
}
