import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import FocusLock from 'react-focus-lock';

interface ActionConfirmModalProps {
  isOpen: boolean;
  type: 'mailto' | 'trueconf' | null;
  fullName: string;
  email?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Подтверждение внешнего действия (письмо / звонок в TrueConf). */
export function ActionConfirmModal({ isOpen, type, fullName, email, onConfirm, onCancel }: ActionConfirmModalProps) {
  const { t } = useTranslation();

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && type && (
        <FocusLock returnFocus>
          <div
            className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center p-4"
            role="alertdialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onCancel}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-surface w-full max-w-[400px] rounded-[24px] p-6 shadow-2xl border border-border flex flex-col gap-5 text-center relative z-10"
            >
              <h3 className="text-[22px] font-bold text-foreground">{t('action.confirmTitle')}</h3>
              <p className="text-[16px] text-muted-foreground leading-relaxed">
                {type === 'mailto'
                  ? t('action.writeConfirmMsg', { name: fullName, email: email ?? '' })
                  : t('action.trueconfConfirmMsg', { name: fullName })}
              </p>
              <div className="flex justify-center gap-3 mt-4">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-5 py-3 rounded-[12px] text-[15px] font-bold text-foreground/70 hover:bg-input transition-all duration-300 active:translate-y-[1px] border border-border bg-surface cursor-pointer"
                >
                  {t('action.cancelBtn')}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className="px-5 py-3 rounded-[12px] text-[15px] font-bold text-white bg-primary hover:bg-primary-hover transition-all duration-300 active:translate-y-[1px] cursor-pointer"
                >
                  {t('action.goBtn')}
                </button>
              </div>
            </motion.div>
          </div>
        </FocusLock>
      )}
    </AnimatePresence>,
    document.body,
  );
}
