import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings2 } from '@/components/icons';

import { isTauri as isTauriEnv } from '@/api/backend';
import { findOrgGroup, resolveDirectoryScope, resolveEnterpriseName } from '@/lib/orgGroups';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ColleaguesModal } from '@/components/ColleaguesModal';
import type { ColleaguesMode } from '@/components/ColleaguesModal';
import { MainHeader } from '@/components/MainHeader';
import { Sidebar } from '@/components/Sidebar';
import { ContactDetails } from '@/features/contacts/components/ContactDetails';
import { getContactsService } from '@/services/ContactsService';
import { toast } from 'sonner';
import { useContactsList } from '@/features/contacts/hooks/useContactsList';
import { useOrganizations } from '@/hooks/useDirectory';
import { isMockMode } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

/** The open colleague list: the card field, value and contact organization. */
interface ColleaguesView {
  mode: ColleaguesMode;
  value: string;
  organization: string | null;
}

/** The main screen: contact list + the selected employee card. */
export function PhonebookView() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const savedContactIds = useAppStore((state) => state.savedContactIds);
  const toggleSavedContact = useAppStore((state) => state.toggleSavedContact);
  const globalMode = useAppStore((state) => state.globalMode);
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectedId = useAppStore((state) => state.selectedId);
  const setSelectedId = useAppStore((state) => state.setSelectedId);
  const search = useAppStore((state) => state.search);
  const setSearch = useAppStore((state) => state.setSearch);
  const selectedOrg = useAppStore((state) => state.selectedOrg);
  const setSelectedOrg = useAppStore((state) => state.setSelectedOrg);
  const selectedGroupId = useAppStore((state) => state.selectedGroupId);
  const setSelectedGroupId = useAppStore((state) => state.setSelectedGroupId);
  const orgGroups = useAppStore((state) => state.orgGroups);
  const testMode = useAppStore((state) => state.testMode);
  const setTestMode = useAppStore((state) => state.setTestMode);
  const ldapConfigs = useAppStore((state) => state.ldapConfigs);
  const enterpriseGroupId = useAppStore((state) => state.enterpriseGroupId);

  const [colleaguesView, setColleaguesView] = useState<ColleaguesView | null>(null);

  // In test mode the directory is fully demonstrational: the settings
  // of real AD (groups, enterprise, organizations) must not leak
  // into filters and labels.
  const directoryScope = useMemo(
    () => resolveDirectoryScope(testMode, ldapConfigs, orgGroups, enterpriseGroupId),
    [testMode, ldapConfigs, orgGroups, enterpriseGroupId],
  );
  const {
    groups: effectiveOrgGroups,
    ldapConfigs: effectiveLdapConfigs,
    enterpriseGroupId: effectiveEnterpriseGroupId,
  } = directoryScope;

  // The selected filter group: the union of its organizations goes into the request whole.
  const selectedGroup = useMemo(() => {
    const group = findOrgGroup(effectiveOrgGroups, selectedGroupId);
    // An empty group is not considered a selected filter (a draft without organizations).
    return group && group.orgs.some((org) => org.trim() !== '') ? group : null;
  }, [effectiveOrgGroups, selectedGroupId]);
  const selectedGroupOrgs = useMemo(
    () => (selectedGroup && selectedGroup.orgs.length > 0 ? selectedGroup.orgs : null),
    [selectedGroup],
  );

  const {
    contacts: filtered,
    total,
    isLoading,
    isFetching,
    isSearchPending,
    isError,
    refetch,
    limitReached,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useContactsList(activeTab, search, selectedOrg, savedContactIds, selectedGroupOrgs);
  const { data: organizations = [] } = useOrganizations();

  // Enterprise filter for the "KMAruda" tab: group name from settings,
  // without a selected group - the first configured AD organization.
  const enterpriseOrg = useMemo(
    () => resolveEnterpriseName(effectiveLdapConfigs, effectiveOrgGroups, effectiveEnterpriseGroupId),
    [effectiveLdapConfigs, effectiveOrgGroups, effectiveEnterpriseGroupId],
  );

  // The organization and the filter group mutually exclude each other.
  const handleSelectOrg = useCallback(
    (org: string | null) => {
      setSelectedOrg(org);
      setSelectedGroupId(null);
    },
    [setSelectedOrg, setSelectedGroupId],
  );
  const handleSelectGroup = useCallback(
    (id: string | null) => {
      setSelectedGroupId(id);
      setSelectedOrg(null);
    },
    [setSelectedGroupId, setSelectedOrg],
  );

  // The deep link /settings?view=ad is handled by the router; here —
  // tab normalization when switching the global mode.
  useEffect(() => {
    if (globalMode) {
      if (activeTab === 'kmaruda') {
        setActiveTab('global');
      }
    } else if (activeTab === 'global' && (selectedOrg || selectedGroupId)) {
      // Outside the global version there is no organization filter at all:
      // reset both the organization and the selected group.
      setSelectedOrg(null);
      setSelectedGroupId(null);
    }
  }, [globalMode, activeTab, selectedOrg, selectedGroupId, setActiveTab, setSelectedOrg, setSelectedGroupId]);

  // Reset the selection when the data mode changes (test <-> live). Filters
  // of real AD do not apply in test mode, so we clear them too.
  useEffect(() => {
    setSelectedId(null);
    setSelectedOrg(null);
    setSelectedGroupId(null);
  }, [testMode, setSelectedId, setSelectedOrg, setSelectedGroupId]);

  // Changing the tab/filter starts a new selection; a card from the previous
  // filter must not remain open. This effect must run BEFORE the auto-select
  // effect below: otherwise a quick tab switch can clear the freshly selected
  // first result and leave the detail pane out of sync with the list.
  const filterKey = `${activeTab}|${selectedOrg ?? ''}|${selectedGroupId ?? ''}|${effectiveEnterpriseGroupId ?? ''}`;
  const previousFilterKey = useRef(filterKey);
  useEffect(() => {
    if (previousFilterKey.current === filterKey) {
      return;
    }
    previousFilterKey.current = filterKey;
    setSelectedId(null);
  }, [filterKey, setSelectedId]);

  // The search itself opens the card: the only match or the top
  // list result - the user does not need to aim at the list manually.
  // A manual selection within the result set is not overridden until the set changes.
  useEffect(() => {
    // While the initial load/top-up is running or the result of the current input is not yet
    // known, do not touch the selection: the list may still be empty while the card already
    // opened by the user.
    if (isLoading || isFetching || isSearchPending) {
      return;
    }
    const currentId = useAppStore.getState().selectedId;
    if (filtered.length === 0) {
      // The search/filter gave no matches - the old result card
      // must not remain on the right.
      if (currentId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (search.trim() !== '' && currentId !== filtered[0].id) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, isFetching, isLoading, isSearchPending, search, setSelectedId]);

  const handleSettingsClick = useCallback(() => navigate('/settings'), [navigate]);
  const handleConfigureAdClick = useCallback(() => navigate('/settings?view=ad'), [navigate]);
  const handleConfigureGroupsClick = useCallback(() => navigate('/settings?view=groups'), [navigate]);
  // Clicking a department / job title / office in the card opens a list of
  // colleagues by the same field; the contact's organization limits the results,
  // so identical offices and job titles from different organizations are not mixed.
  const handleDepartmentClick = useCallback((department: string, organization?: string) => {
    setColleaguesView({ mode: 'department', value: department, organization: organization ?? null });
  }, []);
  const handleTitleClick = useCallback((title: string, organization?: string) => {
    setColleaguesView({ mode: 'title', value: title, organization: organization ?? null });
  }, []);
  const handleOfficeClick = useCallback((office: string, organization?: string) => {
    setColleaguesView({ mode: 'office', value: office, organization: organization ?? null });
  }, []);
  const handleBackToSidebar = useCallback(() => setSelectedId(null), [setSelectedId]);

  /**
   * Clicking a manager opens their card. By GUID — instantly;
   * if the manager is outside the AD sample (the GUID was not resolved during sync),
   * we search by name and open the exact match.
   */
  const handleManagerClick = useCallback(
    async (manager: string, managerId?: string) => {
      if (managerId) {
        setSelectedId(managerId);
        return;
      }
      try {
        const page = await getContactsService().search({
          activeTab: 'global',
          search: manager,
          limit: 1,
        });
        const match = page.contacts[0];
        if (match) {
          setSelectedId(match.id);
        } else {
          toast.info(t('managerNotFound'), { id: 'manager-not-found' });
        }
      } catch {
        toast.error(t('errorLoadContacts'), { id: 'manager-lookup-error' });
      }
    },
    [setSelectedId, t],
  );

  const browserLocked = !isTauriEnv() && !testMode;
  const directoryNotConfigured = !isMockMode() && !browserLocked && ldapConfigs.length === 0;
  // In non-global mode the "KMAruda" tab works only by the starred
  // group. Without a selected group we do not substitute the first
  // AD connection and do not show the whole holding.
  const enterpriseGroup = findOrgGroup(effectiveOrgGroups, effectiveEnterpriseGroupId);
  const enterpriseGroupReady = Boolean(enterpriseGroup && enterpriseGroup.orgs.some((org) => org.trim() !== ''));
  const enterpriseGroupScopeActive = !browserLocked && activeTab === 'kmaruda' && (testMode || ldapConfigs.length > 0);
  const enterpriseGroupsMissing = enterpriseGroupScopeActive && orgGroups.length === 0;
  const enterpriseGroupNotSelected = enterpriseGroupScopeActive && orgGroups.length > 0 && !enterpriseGroupReady;
  const enterpriseGroupsUnavailable = enterpriseGroupsMissing || enterpriseGroupNotSelected;

  // The empty state depends on the context: browser / favorites /
  // search query / AD not configured / no enterprise groups /
  // not synchronized yet.
  const emptyState = browserLocked
    ? { title: t('browserMode.title'), description: t('browserMode.desc') }
    : activeTab === 'local'
      ? { title: t('emptyLocal.title'), description: t('emptyLocal.desc') }
      : search.trim()
        ? isSearchPending
          ? { title: t('emptySearch.title'), description: t('emptySearch.desc') }
          : { title: t('noMatches'), description: t('tryAnotherSearch') }
        : enterpriseGroupNotSelected
          ? { title: t('emptyEnterprise.noSelectionTitle'), description: t('emptyEnterprise.noSelectionDesc') }
          : enterpriseGroupsMissing
            ? { title: t('emptyEnterprise.title'), description: t('emptyEnterprise.desc') }
            : directoryNotConfigured
              ? { title: t('emptyState.title'), description: t('emptyState.desc') }
              : !search.trim() && !selectedOrg && !selectedGroup
                ? { title: t('emptySearch.title'), description: t('emptySearch.desc') }
                : { title: t('emptyState.notSyncedTitle'), description: t('emptyState.notSyncedDesc') };

  return (
    <>
      <MainHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        search={search}
        setSearch={setSearch}
        selectedOrg={selectedOrg}
        setSelectedOrg={handleSelectOrg}
        selectedGroupId={selectedGroup?.id ?? null}
        setSelectedGroupId={handleSelectGroup}
        orgGroups={effectiveOrgGroups}
        globalMode={globalMode}
        onSettingsClick={handleSettingsClick}
        organizations={organizations}
        enterpriseOrg={enterpriseOrg}
        selectedGroupName={selectedGroup?.name ?? null}
      />

      <div className="flex-1 flex overflow-hidden w-full relative z-0">
        <ErrorBoundary>
          <div className="flex w-full md:w-[340px] xl:w-[400px] h-full shrink-0 border-r border-border bg-background/50">
            <Sidebar
              contacts={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              selectedOrg={selectedOrg}
              activeTab={activeTab}
              isLoading={isLoading}
              isError={isError}
              onRetry={refetch}
              limitReached={limitReached}
              total={total}
              showUnsave={activeTab === 'local'}
              onUnsave={toggleSavedContact}
              onLoadMore={fetchNextPage}
              hasMore={hasNextPage}
              isFetchingMore={isFetchingNextPage}
              emptyTitle={emptyState.title}
              emptyDescription={emptyState.description}
              emptyAction={
                browserLocked ? (
                  <button
                    type="button"
                    onClick={() => setTestMode(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    {t('browserMode.enableTest')}
                  </button>
                ) : enterpriseGroupsUnavailable ? (
                  <button
                    type="button"
                    onClick={handleConfigureGroupsClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    <Settings2 className="w-4 h-4" aria-hidden />
                    {t('emptyEnterprise.action')}
                  </button>
                ) : directoryNotConfigured ? (
                  <button
                    type="button"
                    onClick={handleConfigureAdClick}
                    className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    <Settings2 className="w-4 h-4" aria-hidden />
                    {t('emptyState.configure')}
                  </button>
                ) : undefined
              }
            />
          </div>
        </ErrorBoundary>

        <ErrorBoundary>
          <div
            className={`absolute md:relative inset-0 md:inset-auto z-10 md:z-0 w-full h-full md:flex-1 bg-background flex flex-col transition-transform duration-300 ease-in-out ${
              selectedId ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
            }`}
          >
            {selectedId ? (
              <ContactDetails
                key={selectedId}
                contactId={selectedId}
                onBack={handleBackToSidebar}
                onDepartmentClick={handleDepartmentClick}
                onTitleClick={handleTitleClick}
                onOfficeClick={handleOfficeClick}
                onManagerClick={handleManagerClick}
              />
            ) : (
              <div className="flex-1 items-center justify-center text-muted-foreground text-[15px] font-medium h-full hidden md:flex">
                {isLoading ? t('loading') : t('selectContact')}
              </div>
            )}
          </div>
        </ErrorBoundary>

        <ColleaguesModal
          isOpen={colleaguesView !== null}
          onClose={() => setColleaguesView(null)}
          mode={colleaguesView?.mode ?? 'department'}
          value={colleaguesView?.value ?? null}
          organization={colleaguesView?.organization ?? null}
          onSelectContact={(id: Contact['id']) => setSelectedId(id)}
        />
      </div>
    </>
  );
}
