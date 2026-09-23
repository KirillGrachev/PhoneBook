import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { MailWarning } from 'lucide-react';
import FocusLock, { AutoFocusInside } from 'react-focus-lock';
import { useTranslation } from 'react-i18next';

import { Switch } from '@/components/ui/Switch';

interface EmailPromptModalProps {
  isOpen: boolean;
  fullName: string;
  /** Уже сохранённая подмена (если есть) — предварительное значение. */
  initialEmail?: string;
  onCancel: () => void;
  onSubmit: (email: string, remember: boolean) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Диалог ввода почты для контактов без атрибута mail в AD.
 * Позволяет написать письмо и (опционально) сохранить адрес как локальную
 * подмену — софт остаётся рабочим даже при неполных данных каталога.
 */
export function EmailPromptModal({ isOpen, fullName, initialEmail, onCancel, onSubmit }: EmailPromptModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [remember, setRemember] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEmail(initialEmail ?? '');
      setRemember(true);
      setInvalid(false);
    }
  }, [isOpen, initialEmail]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  const submit = () => {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setInvalid(true);
      return;
    }
    onSubmit(value, remember);
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
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
              className="bg-surface w-full max-w-[420px] rounded-[24px] p-6 shadow-2xl border border-border flex flex-col gap-4 relative z-10"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[12px] bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                  <MailWarning className="w-5 h-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[18px] font-bold text-foreground leading-tight">{t('emailPrompt.title')}</h3>
                  <p className="text-[13px] text-muted-foreground truncate">{fullName}</p>
                </div>
              </div>

              <p className="text-[13px] text-muted-foreground leading-relaxed">{t('emailPrompt.desc')}</p>

              <AutoFocusInside>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setInvalid(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={t('emailPrompt.placeholder')}
                  aria-label={t('emailPrompt.placeholder')}
                  aria-invalid={invalid}
                  className={`w-full h-[44px] px-4 rounded-[12px] bg-input border text-foreground text-[15px] outline-none transition-all placeholder:text-muted-foreground ${
                    invalid ? 'border-red-500/70' : 'border-border'
                  }`}
                />
              </AutoFocusInside>
              {invalid && (
                <span className="text-[12px] text-red-500 font-medium -mt-2">{t('emailPrompt.invalid')}</span>
              )}

              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <span className="text-[14px] font-semibold text-foreground">{t('emailPrompt.remember')}</span>
                <Switch checked={remember} onChange={setRemember} ariaLabel={t('emailPrompt.remember')} />
              </label>

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-foreground/70 hover:bg-input transition-all border border-border bg-surface cursor-pointer"
                >
                  {t('action.cancelBtn')}
                </button>
                <button
                  type="button"
                  onClick={submit}
                  className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-white bg-primary hover:bg-primary-hover transition-all cursor-pointer"
                >
                  {t('emailPrompt.submit')}
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
