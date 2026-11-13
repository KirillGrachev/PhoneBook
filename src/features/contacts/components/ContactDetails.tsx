import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Loader2, QrCode } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import { systemApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import { personNameForLanguage } from '@/lib/transliteration';
import { IconButton } from '@/components/ui/IconButton';
import { ActionConfirmModal } from '@/components/ActionConfirmModal';
import { CompanyInfoCard } from '@/features/contacts/components/CompanyInfoCard';
import { ContactHeader } from '@/features/contacts/components/ContactHeader';
import { ContactInfoCard } from '@/features/contacts/components/ContactInfoCard';
import { EmailPromptModal } from '@/features/contacts/components/EmailPromptModal';
import { IpPhoneSection } from '@/features/contacts/components/IpPhoneSection';
import { useContact, useVcard } from '@/features/contacts/hooks/useContactData';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

const VsimModal = lazy(() => import('@/components/VsimModal').then((module) => ({ default: module.VsimModal })));
const QRCodeLazy = lazy(() => import('@/components/QRCodeComponent'));

interface ContactDetailsProps {
  contactId: string;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  onBack: () => void;
  onDepartmentClick?: (department: string, org?: string) => void;
  /** ÐšÐ»Ð¸Ðº Ð¿Ð¾ Ð´Ð¾Ð»Ð¶Ð½Ð¾ÑÑ‚Ð¸: ÑÐ¿Ð¸ÑÐ¾Ðº Ð»ÑŽÐ´ÐµÐ¹ Ñ Ñ‚Ð¾Ð¹ Ð¶Ðµ Ð´Ð¾Ð»Ð¶Ð½Ð¾ÑÑ‚ÑŒÑŽ Ð² Ñ‚Ð¾Ð¹ Ð¶Ðµ Ð¾Ñ€Ð³Ð°Ð½Ð¸Ð·Ð°Ñ†Ð¸Ð¸. */
  onTitleClick?: (title: string, org?: string) => void;
  /** ÐšÐ»Ð¸Ðº Ð¿Ð¾ ÐºÐ°Ð±Ð¸Ð½ÐµÑ‚Ñƒ: ÑÐ¿Ð¸ÑÐ¾Ðº Ð»ÑŽÐ´ÐµÐ¹ Ð² Ñ‚Ð¾Ð¼ Ð¶Ðµ ÐºÐ°Ð±Ð¸Ð½ÐµÑ‚Ðµ. */
  onOfficeClick?: (office: string, org?: string) => void;
  /** ÐšÐ»Ð¸Ðº Ð¿Ð¾ Ñ€ÑƒÐºÐ¾Ð²Ð¾Ð´Ð¸Ñ‚ÐµÐ»ÑŽ: Ð¾Ñ‚ÐºÑ€Ñ‹Ð²Ð°ÐµÑ‚ ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÑƒ Ñ€ÑƒÐºÐ¾Ð²Ð¾Ð´Ð¸Ñ‚ÐµÐ»Ñ (guid Ð¸Ð»Ð¸ Ð¿Ð¾Ð¸ÑÐº Ð¿Ð¾ Ð¸Ð¼ÐµÐ½Ð¸). */
  onManagerClick?: (manager: string, managerId?: string) => void;
}

type PendingAction = { type: 'mailto' | 'trueconf'; url: string };

/**
 * ÐŸÐ»Ð°Ð²Ð½Ñ‹Ð¹ ÑÐºÐµÐ»ÐµÑ‚Ð¾Ð½ Ð½Ð° Ð²Ñ€ÐµÐ¼Ñ Ð³ÐµÐ½ÐµÑ€Ð°Ñ†Ð¸Ð¸ vCard: ÑÐ²ÐµÑ‚Ð»Ñ‹Ð¹ Ñ„Ð¾Ð½ (ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ° QR Ð±ÐµÐ»Ð°Ñ),
 * Ð¼ÑÐ³ÐºÐ°Ñ Ð¿ÑƒÐ»ÑŒÑÐ°Ñ†Ð¸Ñ Ð¸ ÑÐ¿Ð¸Ð½Ð½ÐµÑ€ â€” Ð²Ð¼ÐµÑÑ‚Ð¾ Ñ‚Ñ‘Ð¼Ð½Ð¾Ð³Ð¾ ÐºÐ²Ð°Ð´Ñ€Ð°Ñ‚Ð°.
 */
function QrPlaceholder({ size }: { size: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-[12px] bg-slate-100 flex items-center justify-center relative overflow-hidden"
    >
      <div className="absolute inset-0 animate-pulse bg-slate-200/70" />
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin relative" aria-hidden />
    </div>
  );
}

/**
 * ÐšÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ° ÐºÐ¾Ð½Ñ‚Ð°ÐºÑ‚Ð°.
 *
 * Ð”Ð°Ð½Ð½Ñ‹Ðµ Ð±ÐµÑ€ÑƒÑ‚ÑÑ Ñ‚Ð¾Ñ‡ÐµÑ‡Ð½Ñ‹Ð¼ Ð·Ð°Ð¿Ñ€Ð¾ÑÐ¾Ð¼ `get_contact` (Ð° Ð½Ðµ Ð¿Ð¾Ð¸ÑÐºÐ¾Ð¼ Ð¿Ð¾ Ð²ÑÐµÐ¼Ñƒ
 * ÑÐ¿Ð¸ÑÐºÑƒ, ÐºÐ°Ðº Ð² Ð¸ÑÑ…Ð¾Ð´Ð½Ð¾Ð¹ Ð²ÐµÑ€ÑÐ¸Ð¸). ÐÐ²Ð°Ñ‚Ð°Ñ€ â€” Ð±ÑƒÐºÐ²ÐµÐ½Ð½Ñ‹Ð¹: Ñ„Ð¾Ñ‚Ð¾Ð³Ñ€Ð°Ñ„Ð¸Ð¸ Ð¸Ð· AD
 * ÑÐ¾Ð·Ð½Ð°Ñ‚ÐµÐ»ÑŒÐ½Ð¾ Ð½Ðµ Ñ‚ÑÐ½ÐµÐ¼ (ÑÐ¼. `Avatar`).
 * Ð’Ð½ÐµÑˆÐ½Ð¸Ðµ Ð´ÐµÐ¹ÑÑ‚Ð²Ð¸Ñ (mailto/trueconf) Ð¸Ð´ÑƒÑ‚ Ñ‡ÐµÑ€ÐµÐ· Rust-ÐºÐ¾Ð¼Ð°Ð½Ð´Ñƒ `open_external`
 * Ñ allow-list ÑÑ…ÐµÐ¼ Ð²Ð¼ÐµÑÑ‚Ð¾ Ð¿Ñ€ÑÐ¼Ð¾Ð³Ð¾ shell-Ð¿Ð»Ð°Ð³Ð¸Ð½Ð°.
 */
export function ContactDetails({
  contactId,
  isSaved,
  onToggleSave,
  onBack,
  onDepartmentClick,
  onTitleClick,
  onOfficeClick,
  onManagerClick,
}: ContactDetailsProps) {
  const { t, i18n } = useTranslation();
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);

  const { data: contact, isLoading, isError } = useContact(contactId);
  const displayName = contact ? personNameForLanguage(contact.fullName, i18n.language) : '';

  const [isVsimOpen, setIsVsimOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);

  const emailOverrides = useAppStore((state) => state.emailOverrides);
  const setEmailOverride = useAppStore((state) => state.setEmailOverride);

  // Ð›Ð¾ÐºÐ°Ð»ÑŒÐ½Ð°Ñ Ð¿Ð¾Ð´Ð¼ÐµÐ½Ð° Ð¿Ð¾Ñ‡Ñ‚Ñ‹ Ð¿Ñ€Ð¸Ð¾Ñ€Ð¸Ñ‚ÐµÑ‚Ð½ÐµÐµ Ð°Ñ‚Ñ€Ð¸Ð±ÑƒÑ‚Ð° mail (ÐºÐ¾Ñ‚Ð¾Ñ€Ð¾Ð³Ð¾ Ð¼Ð¾Ð¶ÐµÑ‚ Ð½Ðµ Ð±Ñ‹Ñ‚ÑŒ).
  const effectiveEmail = contact ? (emailOverrides[contact.id] ?? contact.email) : undefined;
  const contactWithEmail = useMemo<Contact | null>(
    () => (contact ? { ...contact, email: effectiveEmail } : null),
    [contact, effectiveEmail],
  );

  const handleWrite = () => {
    if (effectiveEmail) {
      devLog('write', { contactId: contact?.id, email: effectiveEmail });
      setPendingAction({ type: 'mailto', url: `mailto:${effectiveEmail}` });
    } else {
      // ÐŸÐ¾Ñ‡Ñ‚Ñ‹ Ð½ÐµÑ‚ Ð² AD â€” Ð¿Ñ€ÐµÐ´Ð»Ð°Ð³Ð°ÐµÐ¼ ÑƒÐºÐ°Ð·Ð°Ñ‚ÑŒ Ð²Ñ€ÑƒÑ‡Ð½ÑƒÑŽ, ÑÐ¾Ñ„Ñ‚ Ð¾ÑÑ‚Ð°Ñ‘Ñ‚ÑÑ Ñ€Ð°Ð±Ð¾Ñ‡Ð¸Ð¼.
      devLog('write', { contactId: contact?.id, email: null, prompt: true });
      setEmailPromptOpen(true);
    }
  };

  const handleEmailSubmit = (email: string, remember: boolean) => {
    if (remember && contact) {
      setEmailOverride(contact.id, email);
    }
    setEmailPromptOpen(false);
    devLog('write', { contactId: contact?.id, email, manual: true, remember });
    setPendingAction({ type: 'mailto', url: `mailto:${email}` });
  };

  const vcardValue = useVcard(contactWithEmail ?? null);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-[14px]" role="status">
        {t('loading')}
      </div>
    );
  }

  if (isError || !contact) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-foreground font-semibold mb-2">{t('failedToLoadContact')}</p>
        <button type="button" onClick={onBack} className="text-primary hover:underline text-[14px] cursor-pointer">
          {t('goBack')}
        </button>
      </div>
    );
  }

  const confirmRunAction = async () => {
    if (pendingAction) {
      devLog('open-external', { type: pendingAction.type, url: pendingAction.url });
      try {
        await systemApi.openExternal(pendingAction.url);
        devLog('open-external', { url: pendingAction.url, result: 'ok' });
      } catch (error) {
        devLog('open-external', { url: pendingAction.url, result: 'error', error });
        console.error('[contact] Ð½Ðµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¾Ñ‚ÐºÑ€Ñ‹Ñ‚ÑŒ Ð²Ð½ÐµÑˆÐ½ÐµÐµ Ð¿Ñ€Ð¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ðµ', error);
        // Ð”Ð»Ñ mailto Ð±Ñ€Ð°ÑƒÐ·ÐµÑ€Ð½Ñ‹Ð¹ fallback Ð±ÐµÐ·Ð¾Ð¿Ð°ÑÐµÐ½; Ð¿Ñ€Ð¾Ñ‡Ð¸Ðµ ÑÑ…ÐµÐ¼Ñ‹ â€” Ð½ÐµÑ‚.
        if (pendingAction.type === 'mailto') {
          window.location.href = pendingAction.url;
        }
      }
    }
    setPendingAction(null);
  };

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={contact.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={animationsEnabled ? { duration: 0.15, ease: 'easeInOut' } : { duration: 0 }}
          className="flex-1 w-full relative h-full overflow-y-auto overflow-x-hidden"
        >
          {/* m-auto: Ð½Ð° Ð²Ñ‹ÑÐ¾ÐºÐ¸Ñ… ÑÐºÑ€Ð°Ð½Ð°Ñ… ÐºÐ°Ñ€Ñ‚Ð¾Ñ‡ÐºÐ° Ñ†ÐµÐ½Ñ‚Ñ€Ð¸Ñ€ÑƒÐµÑ‚ÑÑ Ð¿Ð¾ Ð²ÐµÑ€Ñ‚Ð¸ÐºÐ°Ð»Ð¸,
              Ð° Ð½Ðµ Ð¿Ñ€Ð¸Ð»Ð¸Ð¿Ð°ÐµÑ‚ Ðº Ð²ÐµÑ€Ñ…Ñƒ; Ð¿Ñ€Ð¸ Ð½ÐµÑ…Ð²Ð°Ñ‚ÐºÐµ Ð¼ÐµÑÑ‚Ð° â€” Ð¾Ð±Ñ‹Ñ‡Ð½Ñ‹Ð¹ ÑÐºÑ€Ð¾Ð»Ð». */}
          <div className="min-h-full flex flex-col pt-20 sm:pt-24 md:pt-10 px-6 xl:px-8 pb-8">
            <div className="m-auto w-full max-w-[1100px]">
              <div className="md:hidden absolute top-4 left-4 z-10 bg-surface rounded-full shadow-sm ring-1 ring-border/50">
                <IconButton onClick={onBack} icon={ChevronLeft} aria-label={t('back')} />
              </div>

              <ContactHeader
                contact={contactWithEmail ?? contact}
                isSaved={isSaved}
                onToggleSave={onToggleSave}
                onWrite={handleWrite}
                onActionClick={(type, url) => {
                  devLog('action-request', { type, url });
                  setPendingAction({ type, url });
                }}
              />

              <IpPhoneSection ipPhone={contact.ipPhone} fullIpPhone={contact.fullIpPhone} />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8 lg:gap-5 xl:gap-6 w-full items-start">
                <ContactInfoCard contact={contact} effectiveEmail={effectiveEmail} onWrite={handleWrite} />
                <CompanyInfoCard
                  contact={contact}
                  onDepartmentClick={onDepartmentClick}
                  onTitleClick={onTitleClick}
                  onOfficeClick={onOfficeClick}
                  onManagerClick={onManagerClick}
                />

                <div className="w-full min-w-0 lg:col-span-2">
                  <h3 className="text-[12px] font-bold text-muted-foreground mb-3 px-2 uppercase">{t('scanQrCode')}</h3>
                  <div className="bg-surface rounded-[16px] shadow-sm ring-1 ring-border/50 p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-5 sm:gap-6 transition-colors">
                    <button
                      type="button"
                      onClick={() => setIsVsimOpen(true)}
                      className="group relative bg-white p-3.5 rounded-[16px] shadow-sm ring-1 ring-black/5 dark:ring-white/10 dark:shadow-none shrink-0 cursor-pointer outline-none"
                      aria-label={t('scanQrCode')}
                    >
                      <div>
                        <Suspense fallback={<QrPlaceholder size={120} />}>
                          {vcardValue ? (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.96 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={animationsEnabled ? { duration: 0.35, ease: 'easeOut' } : { duration: 0 }}
                            >
                              <QRCodeLazy value={vcardValue} size={120} bgColor="#ffffff" fgColor="#000000" level="M" />
                            </motion.div>
                          ) : (
                            <QrPlaceholder size={120} />
                          )}
                        </Suspense>
                      </div>

                      {/* Ð—Ð½Ð°Ñ‡Ð¾Ðº Ð·ÑƒÐ¼Ð° Ð¿Ð¾ Ñ†ÐµÐ½Ñ‚Ñ€Ñƒ: Ð¿Ð¾ÑÐ²Ð»ÑÐµÑ‚ÑÑ Ð¿Ñ€Ð¸ Ð½Ð°Ð²ÐµÐ´ÐµÐ½Ð¸Ð¸,
                        Ñ‚Ñ‘Ð¼Ð½Ñ‹Ð¹ ÐºÑ€ÑƒÐ³ Ñ Ð±ÐµÐ»Ð¾Ð¹ Ð¸ÐºÐ¾Ð½ÐºÐ¾Ð¹ â€” Ð²Ð¸Ð´ÐµÐ½ Ð½Ð° Ð»ÑŽÐ±Ð¾Ð¼ Ñ„Ð¾Ð½Ðµ */}
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                        <span className="bg-slate-900/90 p-4 rounded-full text-white shadow-xl ring-1 ring-white/30 scale-90 group-hover:scale-100 transition-transform duration-300">
                          <QrCode className="w-7 h-7" aria-hidden />
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-col gap-3 text-center sm:text-left min-w-0">
                      <p className="text-[15px] font-medium text-foreground leading-snug lg:max-w-[400px] break-words">
                        {t('vsimInstruction', { name: displayName })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <ActionConfirmModal
              isOpen={Boolean(pendingAction)}
              type={pendingAction?.type ?? null}
              fullName={displayName}
              email={effectiveEmail}
              onConfirm={() => void confirmRunAction()}
              onCancel={() => setPendingAction(null)}
            />

            <EmailPromptModal
              isOpen={emailPromptOpen}
              fullName={displayName}
              initialEmail={emailOverrides[contact.id]}
              onCancel={() => setEmailPromptOpen(false)}
              onSubmit={handleEmailSubmit}
            />
          </div>
        </motion.div>
      </AnimatePresence>
      <Suspense fallback={null}>
        <VsimModal isOpen={isVsimOpen} onClose={() => setIsVsimOpen(false)} contact={contactWithEmail} />
      </Suspense>
    </>
  );
}
