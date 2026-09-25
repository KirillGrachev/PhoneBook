import { lazy, Suspense, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Briefcase,
  Building2,
  ChevronLeft,
  Loader2,
  Mail,
  MapPin,
  Network,
  Smartphone,
  UserRound,
  ZoomIn,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { systemApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import { DetailRow } from '@/components/DetailRow';
import { IconButton } from '@/components/ui/IconButton';
import { ActionConfirmModal } from '@/components/ActionConfirmModal';
import { ContactHeader } from '@/features/contacts/components/ContactHeader';
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
  /** Клик по должности: список людей с той же должностью в той же организации. */
  onTitleClick?: (title: string, org?: string) => void;
  /** Клик по кабинету: список людей в том же кабинете. */
  onOfficeClick?: (office: string, org?: string) => void;
  /** Клик по руководителю: открывает карточку руководителя (guid или поиск по имени). */
  onManagerClick?: (manager: string, managerId?: string) => void;
}

type PendingAction = { type: 'mailto' | 'trueconf'; url: string };

/**
 * Плавный скелетон на время генерации vCard: светлый фон (карточка QR белая),
 * мягкая пульсация и спиннер — вместо тёмного квадрата.
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
 * Карточка контакта.
 *
 * Данные берутся точечным запросом `get_contact` (а не поиском по всему
 * списку, как в исходной версии). Аватар — буквенный: фотографии из AD
 * сознательно не тянем (см. `Avatar`).
 * Внешние действия (mailto/trueconf) идут через Rust-команду `open_external`
 * с allow-list схем вместо прямого shell-плагина.
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
  const { t } = useTranslation();
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);

  const { data: contact, isLoading, isError } = useContact(contactId);

  const [isVsimOpen, setIsVsimOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [emailPromptOpen, setEmailPromptOpen] = useState(false);

  const emailOverrides = useAppStore((state) => state.emailOverrides);
  const setEmailOverride = useAppStore((state) => state.setEmailOverride);

  // Локальная подмена почты приоритетнее атрибута mail (которого может не быть).
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
      // Почты нет в AD — предлагаем указать вручную, софт остаётся рабочим.
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
        console.error('[contact] не удалось открыть внешнее приложение', error);
        // Для mailto браузерный fallback безопасен; прочие схемы — нет.
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
          {/* m-auto: на высоких экранах карточка центрируется по вертикали,
              а не прилипает к верху; при нехватке места — обычный скролл. */}
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
                <div className="w-full min-w-0">
                  <h3 className="text-[12px] font-bold text-muted-foreground mb-3 px-2 uppercase">
                    {t('contactInfo')}
                  </h3>
                  <div className="bg-surface rounded-[16px] shadow-sm ring-1 ring-border/50 overflow-hidden transition-colors">
                    <DetailRow icon={Smartphone} label={t('mobilePhone')} value={contact.mobilePhone} copyable />
                    <div className="h-px bg-border ml-[56px]" />
                    <DetailRow
                      icon={Mail}
                      label={t('email')}
                      value={effectiveEmail}
                      isLink
                      onClick={handleWrite}
                      showArrow={Boolean(effectiveEmail)}
                      copyable
                    />
                  </div>
                </div>

                <div className="w-full min-w-0">
                  <h3 className="text-[12px] font-bold text-muted-foreground mb-3 px-2 uppercase">
                    {t('positionInCompany')}
                  </h3>
                  <div className="bg-surface rounded-[16px] shadow-sm ring-1 ring-border/50 overflow-hidden transition-colors">
                    <DetailRow icon={Building2} label={t('organization')} value={contact.organization} copyable />
                    <div className="h-px bg-border ml-[56px]" />
                    <DetailRow
                      icon={Network}
                      label={t('department')}
                      value={contact.department}
                      onClick={
                        contact.department && onDepartmentClick
                          ? () => onDepartmentClick?.(contact.department as string, contact.organization)
                          : undefined
                      }
                      showArrow={Boolean(contact.department) && Boolean(onDepartmentClick)}
                      copyable
                    />
                    <div className="h-px bg-border ml-[56px]" />
                    <DetailRow
                      icon={Briefcase}
                      label={t('jobTitle')}
                      value={contact.jobTitle}
                      onClick={
                        contact.jobTitle && onTitleClick
                          ? () => onTitleClick?.(contact.jobTitle as string, contact.organization)
                          : undefined
                      }
                      showArrow={Boolean(contact.jobTitle) && Boolean(onTitleClick)}
                      copyable
                    />
                    {contact.office && (
                      <>
                        <div className="h-px bg-border ml-[56px]" />
                        <DetailRow
                          icon={MapPin}
                          label={t('office')}
                          value={contact.office}
                          onClick={
                            contact.office && onOfficeClick
                              ? () => onOfficeClick?.(contact.office as string, contact.organization)
                              : undefined
                          }
                          showArrow={Boolean(contact.office) && Boolean(onOfficeClick)}
                          copyable
                        />
                      </>
                    )}
                    {contact.manager && (
                      <>
                        <div className="h-px bg-border ml-[56px]" />
                        <DetailRow
                          icon={UserRound}
                          label={t('manager')}
                          value={contact.manager}
                          onClick={
                            contact.manager && onManagerClick
                              ? () => onManagerClick?.(contact.manager as string, contact.managerId)
                              : undefined
                          }
                          showArrow={Boolean(contact.manager) && Boolean(onManagerClick)}
                          copyable
                        />
                      </>
                    )}
                  </div>
                </div>

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

                      {/* Значок зума по центру: появляется при наведении,
                        тёмный круг с белой иконкой — виден на любом фоне */}
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                        <span className="bg-slate-900/90 p-4 rounded-full text-white shadow-xl ring-1 ring-white/30 scale-90 group-hover:scale-100 transition-transform duration-300">
                          <ZoomIn className="w-7 h-7" aria-hidden />
                        </span>
                      </span>
                    </button>
                    <div className="flex flex-col gap-3 text-center sm:text-left min-w-0">
                      <p className="text-[15px] font-medium text-foreground leading-snug lg:max-w-[400px] break-words">
                        {t('vsimInstruction', { name: contact.fullName })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <ActionConfirmModal
              isOpen={Boolean(pendingAction)}
              type={pendingAction?.type ?? null}
              fullName={contact.fullName}
              email={effectiveEmail}
              onConfirm={() => void confirmRunAction()}
              onCancel={() => setPendingAction(null)}
            />

            <EmailPromptModal
              isOpen={emailPromptOpen}
              fullName={contact.fullName}
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
