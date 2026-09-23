import { memo } from 'react';
import { Settings } from 'lucide-react';
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
  /** Выбранная группа фильтра по организации (глобальная версия). */
  selectedGroupId: string | null;
  setSelectedGroupId: (id: string | null) => void;
  /** Группы организаций из настроек (объединённые фильтры). */
  orgGroups: OrgGroupDto[];
  globalMode: boolean;
  onSettingsClick: () => void;
  organizations: string[];
  /** Имя фильтра предприятия: группа вкладки «КМАруда» или первая AD-организация. */
  enterpriseOrg: string | null;
  /** Имя выбранной группы фильтра (плейсхолдер поиска глобальной версии). */
  selectedGroupName: string | null;
}

/** Шапка справочника: заголовок, поиск, фильтр по организации, вкладки. */
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

  // Плейсхолдер повторяет область поиска: холдинг / предприятие / избранное.
  // Вкладка предприятия ищет по организации настроек, а не «в своих контактах».
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
              className="text-muted-foreground hover:text-foreground transition-all duration-300 active:translate-y-[1px] p-2 rounded-full hover:bg-surface-hover outline-none"
              aria-label={t('settings')}
            >
              <Settings className="w-[20px] h-[20px]" aria-hidden />
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
                className="text-muted-foreground hover:text-foreground transition-all duration-300 active:translate-y-[1px] p-2 rounded-full hover:bg-surface-hover outline-none cursor-pointer"
                aria-label={t('settings')}
              >
                <Settings className="w-[18px] h-[18px]" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});
