import { useTranslation } from 'react-i18next';

import { Mail, Phone } from '@/components/icons';
import { DetailRow } from '@/components/DetailRow';
import type { Contact } from '@/types';

interface ContactInfoCardProps {
  contact: Contact;
  effectiveEmail?: string;
  onWrite: () => void;
}

/** Mobile/email card of the contact details pane. */
export function ContactInfoCard({ contact, effectiveEmail, onWrite }: ContactInfoCardProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full min-w-0">
      <h3 className="text-[12px] font-bold text-muted-foreground mb-3 px-2 uppercase">{t('contactInfo')}</h3>
      <div className="bg-surface rounded-[16px] shadow-sm ring-1 ring-border/50 overflow-hidden transition-colors">
        <DetailRow icon={Phone} label={t('mobilePhone')} value={contact.mobilePhone} copyable />
        <div className="h-px bg-border" />
        <DetailRow
          icon={Mail}
          label={t('email')}
          value={effectiveEmail}
          isLink
          onClick={onWrite}
          showArrow={Boolean(effectiveEmail)}
          copyable
        />
      </div>
    </div>
  );
}
