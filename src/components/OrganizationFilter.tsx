import { useState } from 'react';
import { Filter, Check, Layers } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import { cva } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';

import type { OrgGroupDto } from '@/api/contracts';
import { collectGroupedOrgs } from '@/lib/orgGroups';
import { cn } from '@/lib/utils';

const filterButtonVariants = cva(
  'w-[52px] h-[52px] flex items-center justify-center rounded-[16px] transition-all duration-300 ease-in-out border border-transparent outline-none relative cursor-pointer',
  {
    variants: {
      active: {
        true: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        false: 'bg-input text-muted-foreground hover:bg-input-hover',
      },
    },
    defaultVariants: { active: false },
  },
);

const itemClass = (selected: boolean) =>
  cn(
    'w-full flex items-center justify-between px-4 py-2 text-[13px] outline-none transition-colors cursor-pointer focus:bg-surface-hover text-left',
    // Выделение — цветом плашки/текста и галочкой, без смены начертания:
    // bold сдвигает текст пункта, а цвет уже несёт состояние.
    selected ? 'text-primary bg-primary/10 focus:bg-primary/10' : 'text-foreground',
  );

const sectionClass = 'px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

interface OrganizationFilterProps {
  organizations: string[];
  /** Группы организаций: объединённые фильтры из настроек. */
  groups: OrgGroupDto[];
  selectedOrg: string | null;
  selectedGroupId: string | null;
  onSelect: (org: string | null) => void;
  onSelectGroup: (id: string | null) => void;
}

/**
 * Фильтр по организации холдинга (виден только в глобальном режиме).
 *
 * Группы из настроек заменяют поглощённые ими организации: в дропдауне
 * группа идёт одним пунктом (союз её организаций), а входящие в неё
 * организации отдельно не показываются.
 */
export function OrganizationFilter({
  organizations,
  groups,
  selectedOrg,
  selectedGroupId,
  onSelect,
  onSelectGroup,
}: OrganizationFilterProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const activeGroups = groups.filter((group) => group.orgs.length > 0);
  const grouped = collectGroupedOrgs(activeGroups);
  const freeOrgs = organizations.filter((org) => !grouped.has(org));
  const filterActive = Boolean(selectedOrg) || Boolean(selectedGroupId);

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <Tooltip.Provider delayDuration={300}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span className="inline-flex">
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    filterButtonVariants({ active: filterActive }),
                    isOpen && !filterActive && 'bg-primary/10 text-primary',
                  )}
                  aria-label={t('filterByOrg')}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                >
                  <Filter className="w-[16px] h-[16px]" aria-hidden />
                  {filterActive && (
                    <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-white shadow-sm" aria-hidden />
                  )}
                </button>
              </DropdownMenu.Trigger>
            </span>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="bottom"
              sideOffset={5}
              className="z-50 bg-slate-800 text-white shadow-xl text-[13px] font-medium rounded-[6px] py-2 px-3 whitespace-nowrap"
            >
              {t('filterByOrg')}
              <Tooltip.Arrow className="fill-slate-800" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="submenu-pop w-[260px] bg-surface rounded-[12px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] border border-border py-2 z-50"
        >
          <div className="px-3 pb-2 pt-1 border-b border-border mb-1">
            <span className="text-[13px] font-bold text-muted-foreground">{t('filterByOrg')}</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            <DropdownMenu.Item asChild>
              <button type="button" className={itemClass(!filterActive)} onClick={() => onSelect(null)}>
                <span>{t('allHolding')}</span>
                {!filterActive && <Check className="w-[14px] h-[14px]" aria-hidden />}
              </button>
            </DropdownMenu.Item>
            {activeGroups.length > 0 && (
              <>
                <div className={sectionClass}>{t('orgFilterGroups')}</div>
                {activeGroups.map((group) => (
                  <DropdownMenu.Item asChild key={group.id}>
                    <button
                      type="button"
                      className={itemClass(selectedGroupId === group.id)}
                      onClick={() => onSelectGroup(selectedGroupId === group.id ? null : group.id)}
                    >
                      {/* Состав группы виден прямо в пункте: в глобальном
                          фильтре группа заменяет поглощённые организации,
                          и без этой строки их «исчезновение» из секции
                          организаций выглядит как несвежий список. */}
                      <span className="flex flex-col gap-0.5 flex-1 pr-2 min-w-0">
                        <span className="flex items-center gap-2 min-w-0">
                          <Layers className="w-[13px] h-[13px] shrink-0" aria-hidden />
                          <span className="truncate">{group.name}</span>
                        </span>
                        <span className="truncate pl-[21px] text-[11px] font-normal text-muted-foreground">
                          {group.orgs.join(', ')}
                        </span>
                      </span>
                      {selectedGroupId === group.id && <Check className="w-[14px] h-[14px] shrink-0" aria-hidden />}
                    </button>
                  </DropdownMenu.Item>
                ))}
                {freeOrgs.length > 0 && <div className={sectionClass}>{t('orgFilterOrgs')}</div>}
              </>
            )}
            {freeOrgs.map((org) => (
              <DropdownMenu.Item asChild key={org}>
                <button type="button" className={itemClass(selectedOrg === org)} onClick={() => onSelect(org)}>
                  <span className="truncate flex-1 pr-2">{org}</span>
                  {selectedOrg === org && <Check className="w-[14px] h-[14px]" shrink-0 aria-hidden />}
                </button>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
