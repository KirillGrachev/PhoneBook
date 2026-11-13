import { useTranslation } from 'react-i18next';

import { Briefcase, Building2, MapPin, Network, UserRound } from '@/components/icons';
import { DetailRow } from '@/components/DetailRow';
import { personNameForLanguage } from '@/lib/transliteration';
import type { Contact } from '@/types';

interface CompanyInfoCardProps {
  contact: Contact;
  onDepartmentClick?: (department: string, organization?: string) => void;
  onTitleClick?: (title: string, organization?: string) => void;
  onOfficeClick?: (office: string, organization?: string) => void;
  onManagerClick?: (manager: string, managerId?: string) => void;
}

/** Organization/department/title/office/manager card. */
export function CompanyInfoCard({
  contact,
  onDepartmentClick,
  onTitleClick,
  onOfficeClick,
  onManagerClick,
}: CompanyInfoCardProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="w-full min-w-0">
      <h3 className="text-[12px] font-bold text-muted-foreground mb-3 px-2 uppercase">{t('positionInCompany')}</h3>
      <div className="bg-surface rounded-[16px] shadow-sm ring-1 ring-border/50 overflow-hidden transition-colors">
        <DetailRow icon={Building2} label={t('organization')} value={contact.organization} copyable />
        <div className="h-px bg-border" />
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
        <div className="h-px bg-border" />
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
            <div className="h-px bg-border" />
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
            <div className="h-px bg-border" />
            <DetailRow
              icon={UserRound}
              label={t('manager')}
              value={personNameForLanguage(contact.manager, i18n.language)}
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
  );
}
