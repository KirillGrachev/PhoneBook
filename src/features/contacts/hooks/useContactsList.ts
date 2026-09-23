import { useEffect, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { translateBackendError } from '@/lib/errors';
import { getContactsService } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { TabType, Contact } from '@/types';

const SEARCH_DEBOUNCE_MS = 250;

/** Возврат хука списка: контакты, итоги и флаги состояний. */
export interface ContactsListResult {
  contacts: Contact[];
  /** Точное общее число совпадений (без ограничения страницы). */
  total: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Достигнут потолок выдачи — стоит предложить пользователю уточнить запрос. */
  limitReached: boolean;
}

/**
 * Список контактов текущей вкладки с серверным поиском.
 *
 * * строка поиска дебounced-ится, запрос уходит в бэкенд (SQLite FTS);
 * * «Мои контакты» запрашиваются точной выборкой по сохранённым id;
 * * ошибки пробрасываются в UI (состояние + тост), а не глотаются;
 * * `keepPreviousData` устраняет мигание списка при доборе символов.
 */
export function useContactsList(
  activeTab: TabType,
  search: string,
  selectedOrg: string | null,
  savedContactIds: string[],
  selectedGroupOrgs: string[] | null = null,
): ContactsListResult {
  const { t } = useTranslation();
  const testMode = useAppStore((state) => state.testMode);
  const hideEmptyContacts = useAppStore((state) => state.hideEmptyContacts);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  // Стабильный ключ для избранных контактов: перерисовка только при реальном изменении набора.
  const savedKey = useMemo(
    () => (activeTab === 'local' ? [...savedContactIds].sort().join('|') : ''),
    [activeTab, savedContactIds],
  );

  // Союз организаций выбранной группы стабилен между рендерами.
  const groupKey = useMemo(
    () => (selectedGroupOrgs ? [...selectedGroupOrgs].sort().join('|') : ''),
    [selectedGroupOrgs],
  );

  const {
    data: page,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      'contacts',
      'search',
      { activeTab, search: debouncedSearch, selectedOrg, groupKey, savedKey, testMode, hideEmptyContacts },
    ],
    queryFn: () =>
      getContactsService().search({
        activeTab,
        search: debouncedSearch,
        organization: selectedOrg,
        organizations: selectedGroupOrgs,
        savedIds: savedContactIds,
        limit: 0,
        hideEmpty: hideEmptyContacts,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isError) {
      toast.error(translateBackendError(error, t), {
        id: 'contacts-load-error',
        description: t('errorLoadContacts'),
      });
    }
  }, [isError, error, t]);

  // Видимый признак идущего поиска: пока debounced-запрос выполняется,
  // держим loading-тост снизу (тот же слот, что и прогресс синхронизации).
  useEffect(() => {
    if (isFetching && debouncedSearch.trim() !== '') {
      toast.loading(t('searchInProgress'), { id: 'search-progress-toast', duration: Infinity });
    } else {
      toast.dismiss('search-progress-toast');
    }
  }, [isFetching, debouncedSearch, t]);

  const contacts = page?.contacts ?? [];
  const total = page?.total ?? 0;

  return {
    contacts,
    total,
    isLoading,
    isFetching,
    isError,
    error,
    refetch: () => void refetch(),
    limitReached: total > contacts.length,
  };
}
