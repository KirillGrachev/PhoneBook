import { memo } from 'react';
import { Settings } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import { OrganizationFilter } from '@/components/OrganizationFilter';
import { SearchInput } from '@/components/SearchInput';
import { TabSelector } from '@/components/TabSelector';
import type { OrgGroupDto } from '@/api/contracts';
import type { TabType } from '@/types';

interface MainHeaderProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  search: string;
  setSearch: (search: string) => void;
  selectedOrg: string | null;
  setSelectedOrg: (org: string | null) => void;
  /** The selected organization filter group (global version). */
  selectedGroupId: string | null;
  setSelectedGroupId: (id: string | null) => void;
  /** Organization groups from settings (combined filters). */
  orgGroups: OrgGroupDto[];
  globalMode: boolean;
  onSettingsClick: () => void;
  organizations: string[];
  /** The enterprise filter name: the "KMAruda" tab group or the first AD organization. */
  enterpriseOrg: string | null;
  /** The name of the selected filter group (the global-version search placeholder). */
  selectedGroupName: string | null;
}

/** The directory header: title, search, organization filter, tabs. */
export const MainHeader = memo(function MainHeader({
  activeTab,
  setActiveTab,
  search,
  setSearch,
  selectedOrg,
  setSelectedOrg,
  selectedGroupId,
  setSelectedGroupId,
  orgGroups,
  globalMode,
  onSettingsClick,
  organizations,
  enterpriseOrg,
  selectedGroupName,
}: MainHeaderProps) {
  const { t } = useTranslation();

  // The placeholder repeats the search scope: holding / enterprise / favorites.
  // The enterprise tab searches by the settings organization, not "in my contacts".
  const searchPlaceholder =
    activeTab === 'global'
      ? (selectedGroupName ?? selectedOrg)
        ? t('searchByOrg', { org: selectedGroupName ?? selectedOrg ?? '' })
        : t('searchGlobal')
      : activeTab === 'kmaruda'
        ? t('searchByOrg', { org: enterpriseOrg ?? t('kmarudaTab') })
        : selectedOrg
          ? t('searchLocalByOrg', { org: selectedOrg })
          : t('searchLocal');

  return (
    <header
      aria-label="Application Navigation"
      className="shrink-0 bg-surface border-b border-border z-20 shadow-sm transition-colors duration-300 ease-in-out"
    >
      <div className="w-full flex flex-col md:flex-row items-center py-5 lg:py-6">
        <div className="flex items-center gap-3 w-full md:w-[340px] xl:w-[400px] px-6 shrink-0 justify-between md:justify-start">
          <h1 className="text-[28px] font-bold text-foreground tracking-tight m-0">{t('directory')}</h1>

          <div className="md:hidden flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onSettingsClick}
              className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-all duration-300 hover:bg-surface-hover outline-none"
              aria-label={t('settings')}
            >
              <Settings className="w-[22px] h-[22px]" aria-hidden />
            </button>
          </div>
        </div>

        <div className="flex-1 min-w-0 lg:pl-0 md:pr-6 flex flex-col md:flex-row gap-4 mt-4 md:mt-0 items-center justify-end">
          <div className="flex-1 w-full min-w-0 md:min-w-[280px]">
            <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} />
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
            {globalMode && (
              <OrganizationFilter
                organizations={organizations}
                groups={orgGroups}
                selectedOrg={selectedOrg}
                selectedGroupId={selectedGroupId}
                onSelect={setSelectedOrg}
                onSelectGroup={setSelectedGroupId}
              />
            )}
            <div className="flex-1 min-w-0">
              <TabSelector activeTab={activeTab} onTabChange={setActiveTab} globalMode={globalMode} />
            </div>

            <div className="hidden md:flex items-center justify-end gap-1.5 shrink-0 ml-1">
              <button
                type="button"
                onClick={onSettingsClick}
                className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-all duration-300 hover:bg-surface-hover outline-none cursor-pointer"
                aria-label={t('settings')}
              >
                <Settings className="w-[22px] h-[22px]" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});
