import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import FocusLock, { AutoFocusInside } from 'react-focus-lock';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/ui/IconButton';
import QRCode from '@/components/QRCodeComponent';
import { useVcard } from '@/features/contacts/hooks/useContactData';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

interface VsimModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact | null;
}

/** Модальное окно QR-кода визитки (vCard) контакта. */
export function VsimModal({ isOpen, onClose, contact }: VsimModalProps) {
  const { t } = useTranslation();
  const vcardValue = useVcard(contact);
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);

  if (typeof document === 'undefined') {
    return null;
  }

  const transition = animationsEnabled ? { duration: 0.2, ease: 'easeOut' as const } : { duration: 0 };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <FocusLock returnFocus>
          <div
            className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('scanQrCode')}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              onClick={onClose}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={transition}
              style={{ backfaceVisibility: 'hidden' }}
              className="relative bg-surface w-full max-w-[400px] rounded-[24px] shadow-2xl border border-border overflow-hidden flex flex-col z-10"
            >
              <div className="flex items-center justify-between p-4 px-6 border-b border-border bg-surface/50">
                <h3 className="text-[20px] font-bold text-foreground m-0">{t('scanQrCode')}</h3>
                <AutoFocusInside>
                  <IconButton
                    onClick={onClose}
                    icon={X}
                    className="bg-transparent hover:bg-input"
                    aria-label={t('close')}
                  />
                </AutoFocusInside>
              </div>

              <div className="p-8 flex flex-col items-center gap-8 bg-surface">
                <div className="bg-white p-6 rounded-[24px] shadow-sm ring-1 ring-border flex items-center justify-center aspect-square shrink-0 w-full max-w-[280px]">
                  {!vcardValue ? (
                    <div className="w-full h-full rounded-[16px] bg-slate-100 flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 animate-pulse bg-slate-200/70" />
                      <Loader2 className="w-8 h-8 text-slate-400 animate-spin relative" aria-hidden />
                    </div>
                  ) : (
                    <QRCode
                      value={vcardValue}
                      size={240}
                      style={{ height: 'auto', maxWidth: '100%', width: '100%', borderRadius: '0.5rem' }}
                      bgColor="#ffffff"
                      fgColor="#000000"
                      level="H"
                    />
                  )}
                </div>

                <p className="text-center text-[16px] font-medium text-muted-foreground leading-relaxed px-4">
                  {t('vsimInstruction', { name: contact?.fullName ?? '' })}
                </p>
              </div>
            </motion.div>
          </div>
        </FocusLock>
      )}
    </AnimatePresence>,
    document.body,
  );
}
