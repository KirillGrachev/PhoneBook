import { useTranslation } from 'react-i18next';

import type { OrgGroupDto } from '@/api/contracts';
import { Edit, Groups, Trash } from '@/components/icons';
import { cn } from '@/lib/utils';

const ACTION_BUTTON_CLASS =
  'p-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer';

interface OrgGroupCardProps {
  group: OrgGroupDto;
  onEdit: () => void;
  onDelete: () => void;
}

/** Карточка сохранённой группы организаций. */
export function OrgGroupCard({ group, onEdit, onDelete }: OrgGroupCardProps) {
  const { t } = useTranslation();

  return (
    <section
      className="border border-border bg-surface rounded-[16px] p-3.5 shadow-sm flex flex-col gap-2.5"
      aria-label={group.name}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-bold text-[15px] text-foreground min-w-0">
          <Groups className="w-4 h-4 text-primary shrink-0 translate-y-px" aria-hidden />
          <span className="truncate">{group.name}</span>
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className={ACTION_BUTTON_CLASS}
            aria-label={t('settings.orgGroupsEdit')}
            title={t('settings.orgGroupsEdit')}
          >
            <Edit className="w-4 h-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={cn(ACTION_BUTTON_CLASS, 'hover:text-red-500')}
            aria-label={t('settings.orgGroupsDelete')}
            title={t('settings.orgGroupsDelete')}
          >
            <Trash className="w-4 h-4" aria-hidden />
          </button>
        </span>
      </div>

      {group.orgs.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {group.orgs.map((org) => (
            <li key={org} className="px-2 py-0.5 rounded-[8px] bg-input text-[12px] text-foreground/80">
              {org}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[13px] text-muted-foreground">{t('settings.orgGroupsNoOrgs')}</span>
      )}
    </section>
  );
}
