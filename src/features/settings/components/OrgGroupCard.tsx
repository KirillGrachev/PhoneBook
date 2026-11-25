import { useTranslation } from 'react-i18next';

import type { OrgGroupDto } from '@/api/contracts';
import starBadge from '@/assets/icons/star-badge.svg';
import starBadgeOutline from '@/assets/icons/star-badge-outline.svg';
import { Edit, Groups, Trash } from '@/components/icons';
import { cn } from '@/lib/utils';

const ACTION_BUTTON_CLASS =
  'p-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer';

interface OrgGroupCardProps {
  group: OrgGroupDto;
  pinned: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** A card of a saved organization group. */
export function OrgGroupCard({ group, pinned, onTogglePin, onEdit, onDelete }: OrgGroupCardProps) {
  const { t } = useTranslation();

  return (
    <section
      className="border border-border bg-surface rounded-[16px] p-3.5 shadow-sm flex flex-col gap-2.5"
      aria-label={group.name}
    >
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="flex h-8 min-w-0 items-center gap-2 font-bold text-[15px] leading-none text-foreground">
          <Groups className="w-4 h-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{group.name}</span>
        </span>
        <span className="flex h-8 items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onTogglePin}
            className={cn(ACTION_BUTTON_CLASS, pinned ? 'text-amber-500 hover:text-amber-600' : 'hover:text-amber-500')}
            aria-label={t(pinned ? 'settings.orgGroupsUnpin' : 'settings.orgGroupsPin')}
            aria-pressed={pinned}
            title={t(pinned ? 'settings.orgGroupsUnpin' : 'settings.orgGroupsPin')}
          >
            <img src={pinned ? starBadge : starBadgeOutline} alt="" className="w-4 h-4" draggable={false} />
          </button>
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
