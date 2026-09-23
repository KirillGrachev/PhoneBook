import { useEffect, useState } from 'react';
import { Minus, Square, Copy as RestoreIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { isTauri } from '@/api/backend';

interface TitleBarProps {
  title: string;
}

const BUTTON_CLASS =
  'w-[46px] h-full flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors cursor-pointer ' +
  'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset outline-none';

/**
 * Кастомная строка заголовка (окно без системной рамки).
 *
 * Управление окном идёт через штатный JS API `@tauri-apps/api/window`
 * (minimize/toggleMaximize/close) — самописные Rust-команды для этого
 * больше не нужны. Иконка «развернуть/восстановить» синхронизируется
 * с реальным состоянием окна через подписку на resize.
 */
export function TitleBar({ title }: TitleBarProps) {
  const { t } = useTranslation();
  const desktop = isTauri();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) {
      return;
    }

    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    window
      .isMaximized()
      .then(setMaximized)
      .catch((error) => console.warn('[titlebar] isMaximized failed', error));

    window
      .onResized(() => {
        window
          .isMaximized()
          .then(setMaximized)
          .catch(() => {});
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((error) => console.warn('[titlebar] onResized failed', error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  if (!desktop) {
    // Браузерный демо-режим: строка заголовка без оконных кнопок.
    return (
      <div className="relative h-[32px] bg-surface shrink-0 z-[60] flex items-center justify-between select-none border-b border-border">
        <div className="pl-3 flex items-center flex-1 h-full min-w-0">
          <img src="/logo.png" alt="" className="w-4 h-4 mr-2 rounded-[4px] shrink-0" draggable={false} />
          <span className="text-[0.75rem] font-semibold text-foreground/85 uppercase pointer-events-none truncate">
            {title}
          </span>
        </div>
      </div>
    );
  }

  const window = getCurrentWindow();
  const run = (action: Promise<unknown>) =>
    action.catch((error) => console.error('[titlebar] window action failed', error));

  return (
    <div className="relative h-[32px] bg-surface shrink-0 z-[60] flex items-center justify-between select-none border-b border-border">
      <div data-tauri-drag-region className="pl-3 flex items-center flex-1 h-full min-w-0 cursor-default">
        <img src="/logo.png" alt="" className="w-4 h-4 mr-2 rounded-[4px] shrink-0" draggable={false} />
        <span
          data-tauri-drag-region
          className="text-[0.75rem] font-semibold text-foreground/85 uppercase tracking-normal pointer-events-none truncate"
        >
          {title}
        </span>
      </div>

      <div className="flex items-center h-full">
        <button
          type="button"
          onClick={() => void run(window.minimize())}
          className={`${BUTTON_CLASS} hover:bg-foreground/5`}
          title={t('minimize')}
          aria-label={t('minimize')}
        >
          <Minus size={14} className="pointer-events-none" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => void run(window.toggleMaximize())}
          className={`${BUTTON_CLASS} hover:bg-foreground/5`}
          title={maximized ? t('restore') : t('maximize')}
          aria-label={t('maximize')}
          aria-pressed={maximized}
        >
          {maximized ? (
            <RestoreIcon size={13} className="pointer-events-none" aria-hidden />
          ) : (
            <Square size={13} className="pointer-events-none" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => void run(window.close())}
          className={`${BUTTON_CLASS} hover:bg-[#e81123] hover:text-white`}
          title={t('close')}
          aria-label={t('close')}
        >
          <X size={16} className="pointer-events-none" aria-hidden />
        </button>
      </div>
    </div>
  );
}
