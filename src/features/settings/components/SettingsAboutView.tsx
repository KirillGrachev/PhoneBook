import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { systemApi } from '@/api/directory';

const DEVELOPER_URL = 'https://github.com/KirillGrachev';

/** Экран «О программе». Версия берётся из бандла (Tauri API), а не хардкодом. */
export function SettingsAboutView() {
  const { t } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((value) => {
        if (!cancelled) {
          setVersion(value);
        }
      })
      .catch((error) => console.warn('[about] не удалось прочитать версию', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmNavigation = async () => {
    setShowConfirm(false);
    try {
      await systemApi.openExternal(DEVELOPER_URL);
    } catch (error) {
      console.error('[about] не удалось открыть ссылку', error);
      window.open(DEVELOPER_URL, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex flex-col items-center gap-8 w-full pt-6 pb-10">
        <div className="flex flex-col items-center">
          <img src="/logo.png" alt="" className="w-24 h-24 rounded-[22px] shadow-xl mb-5" draggable={false} />
          <h3 className="font-semibold text-foreground text-[32px] leading-none mb-4 text-center">KMARUDA PHONEBOOK</h3>
          <p className="text-[18px] leading-relaxed text-muted-foreground font-medium max-w-[400px] text-center">
            {t('appDesc')}
          </p>
        </div>

        <div className="flex w-full max-w-[400px] flex-col gap-6 pt-10 border-t border-border">
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-bold text-muted-foreground uppercase text-[13px]">{t('developer')}</span>
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="text-foreground hover:text-primary transition-colors font-bold text-[18px] cursor-pointer outline-none rounded-sm bg-transparent border-0 p-0"
            >
              Kirill Grachev
            </button>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <span className="font-bold text-muted-foreground uppercase text-[13px]">{t('version')}</span>
            <span className="font-bold text-foreground text-[18px]">{version ?? '0.2.0'}</span>
          </div>
        </div>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {showConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                role="alertdialog"
                aria-modal="true"
              >
                <div className="absolute inset-0" onClick={() => setShowConfirm(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  style={{ backfaceVisibility: 'hidden', transform: 'translate3d(0, 0, 0)' }}
                  className="bg-surface w-full max-w-[340px] rounded-[24px] p-6 shadow-2xl border border-border flex flex-col gap-5 text-center relative z-10"
                >
                  <h3 className="text-[22px] font-bold text-foreground">{t('about.confirmTitle')}</h3>
                  <p className="text-[16px] text-muted-foreground leading-relaxed">{t('about.confirmMsg')}</p>
                  <div className="flex justify-center gap-3 mt-4">
                    <button
                      type="button"
                      onClick={() => setShowConfirm(false)}
                      className="px-5 py-3 rounded-[12px] text-[15px] font-bold text-foreground/70 hover:bg-input transition-all duration-300 active:translate-y-[1px] border border-border bg-surface cursor-pointer"
                    >
                      {t('about.cancelBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmNavigation()}
                      className="px-5 py-3 rounded-[12px] text-[15px] font-bold text-white bg-primary hover:bg-primary-hover transition-all duration-300 active:translate-y-[1px] cursor-pointer"
                    >
                      {t('about.goBtn')}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
