import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Settings2 } from 'lucide-react';

import { isTauri as isTauriEnv } from '@/api/backend';
import { findOrgGroup, resolveEnterpriseName } from '@/lib/orgGroups';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DepartmentModal } from '@/components/DepartmentModal';
import { MainHeader } from '@/components/MainHeader';
import { Sidebar } from '@/components/Sidebar';
import { ContactDetails } from '@/features/contacts/components/ContactDetails';
import { useContactsList } from '@/features/contacts/hooks/useContactsList';
import { useOrganizations } from '@/hooks/useDirectory';
import { isMockMode } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

/** Главный экран: список контактов + карточка выбранного сотрудника. */
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
  const enterpriseGroupId = useAppStore((state) => state.enterpriseGroupId);
  const testMode = useAppStore((state) => state.testMode);
  const setTestMode = useAppStore((state) => state.setTestMode);
  const ldapConfigs = useAppStore((state) => state.ldapConfigs);

  const [departmentView, setDepartmentView] = useState<{ department: string; organization: string | null } | null>(
    null,
  );

  // Выбранная группа фильтра: союз её организаций уходит в запрос целиком.
  const selectedGroup = useMemo(() => {
    const group = findOrgGroup(orgGroups, selectedGroupId);
    // Пустая группа не считается выбранным фильтром (черновик без организаций).
    return group && group.orgs.some((org) => org.trim() !== '') ? group : null;
  }, [orgGroups, selectedGroupId]);
  const selectedGroupOrgs = useMemo(
    () => (selectedGroup && selectedGroup.orgs.length > 0 ? selectedGroup.orgs : null),
    [selectedGroup],
  );

  const {
    contacts: filtered,
    total,
    isLoading,
    isError,
    refetch,
    limitReached,
  } = useContactsList(activeTab, search, selectedOrg, savedContactIds, selectedGroupOrgs);
  const { data: organizations = [] } = useOrganizations();

  // Фильтр предприятия для вкладки «КМАруда»: имя группы из настроек,
  // а без отмеченной группы — первая настроенная AD-организация.
  const enterpriseOrg = useMemo(
    () => resolveEnterpriseName(ldapConfigs, orgGroups, enterpriseGroupId),
    [ldapConfigs, orgGroups, enterpriseGroupId],
  );

  // Организация и группа фильтра взаимно исключают друг друга.
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

  const isSaved = selectedId ? savedContactIds.includes(selectedId) : false;

  // Глубокая ссылка /settings?view=ad обрабатывается роутером; здесь —
  // нормализация вкладок при переключении глобального режима.
  useEffect(() => {
    if (globalMode) {
      if (activeTab === 'kmaruda') {
        setActiveTab('global');
      }
    } else if (activeTab === 'global' && (selectedOrg || selectedGroupId)) {
      // Вне глобальной версии фильтра по организации нет вовсе:
      // сбрасываем и организацию, и выбранную группу.
      setSelectedOrg(null);
      setSelectedGroupId(null);
    }
  }, [globalMode, activeTab, selectedOrg, selectedGroupId, setActiveTab, setSelectedOrg, setSelectedGroupId]);

  // Сброс выбора при смене режима данных (тестовый ⇄ боевой).
  useEffect(() => {
    setSelectedId(null);
  }, [testMode, setSelectedId]);

  const handleSettingsClick = useCallback(() => navigate('/settings'), [navigate]);
  const handleConfigureAdClick = useCallback(() => navigate('/settings?view=ad'), [navigate]);
  const handleDepartmentClick = useCallback(
    (department: string, organization?: string) =>
      setDepartmentView({ department, organization: organization ?? null }),
    [],
  );
  const handleBackToSidebar = useCallback(() => setSelectedId(null), [setSelectedId]);

  const browserLocked = !isTauriEnv() && !testMode;
  const directoryNotConfigured = !isMockMode() && !browserLocked && ldapConfigs.length === 0;

  // Пустое состояние зависит от контекста: браузер / избранное /
  // поисковый запрос / не настроен AD / ещё не синхронизировано.
  const emptyState = browserLocked
    ? { title: t('browserMode.title'), description: t('browserMode.desc') }
    : activeTab === 'local'
      ? { title: t('emptyLocal.title'), description: t('emptyLocal.desc') }
      : search.trim()
        ? { title: t('noMatches'), description: t('tryAnotherSearch') }
        : directoryNotConfigured
          ? { title: t('emptyState.title'), description: t('emptyState.desc') }
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
        orgGroups={orgGroups}
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
              emptyTitle={emptyState.title}
              emptyDescription={emptyState.description}
              emptyAction={
                browserLocked ? (
                  <button
                    type="button"
                    onClick={() => setTestMode(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors cursor-pointer"
                  >
                    <FlaskConical className="w-4 h-4" aria-hidden />
                    {t('browserMode.enableTest')}
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
                isSaved={isSaved}
                onToggleSave={toggleSavedContact}
                onBack={handleBackToSidebar}
                onDepartmentClick={handleDepartmentClick}
              />
            ) : (
              <div className="flex-1 items-center justify-center text-muted-foreground text-[15px] font-medium h-full hidden md:flex">
                {isLoading ? t('loading') : t('selectContact')}
              </div>
            )}
          </div>
        </ErrorBoundary>

        <DepartmentModal
          isOpen={Boolean(departmentView)}
          onClose={() => setDepartmentView(null)}
          department={departmentView?.department ?? null}
          organization={departmentView?.organization ?? null}
          onSelectContact={(id: Contact['id']) => setSelectedId(id)}
        />
      </div>
    </>
  );
}
