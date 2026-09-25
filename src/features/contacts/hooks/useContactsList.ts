import { useEffect, useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { translateBackendError } from '@/lib/errors';
import { isPhoneQuery } from '@/lib/searchQuery';
import { getContactsService } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { TabType, Contact } from '@/types';

const SEARCH_DEBOUNCE_MS = 250;
/** Размер порции выдачи: список догружается по мере скролла, а не целиком. */
export const CONTACTS_PAGE_SIZE = 300;

/** Возврат хука списка: контакты, итоги и флаги состояний. */
export interface ContactsListResult {
  contacts: Contact[];
  /** Точное общее число совпадений (без ограничения страницы). */
  total: number;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
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
 * * выдача порционная: первая страница 300 записей, следующие догружаются
 *   списком по мере скролла (`useInfiniteQuery`), весь каталог сразу не
 *   передаётся и не парсится;
 * * запрос, похожий на номер телефона, ищет по всему каталогу вне зависимости
 *   от вкладки и фильтров организаций: номер не «принадлежит» вкладке, и
 *   переключение вкладок только усложняло бы поиск;
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

  // Номер телефона ищется по всему каталогу: вкладки и фильтры организаций
  // отключаются, чтобы не заставлять пользователя угадывать вкладку.
  const phoneSearch = isPhoneQuery(debouncedSearch);
  const effectiveTab: TabType = phoneSearch ? 'global' : activeTab;
  const effectiveOrg = phoneSearch ? null : selectedOrg;
  const effectiveGroupKey = phoneSearch ? '' : groupKey;

  const query = useInfiniteQuery({
    queryKey: [
      'contacts',
      'search',
      {
        activeTab: effectiveTab,
        search: debouncedSearch,
        selectedOrg: effectiveOrg,
        groupKey: effectiveGroupKey,
        savedKey,
        testMode,
        hideEmptyContacts,
      },
    ],
    queryFn: ({ pageParam }) =>
      getContactsService().search({
        activeTab: effectiveTab,
        search: debouncedSearch,
        organization: effectiveOrg,
        organizations: phoneSearch ? null : selectedGroupOrgs,
        savedIds: savedContactIds,
        limit: CONTACTS_PAGE_SIZE,
        offset: pageParam,
        hideEmpty: hideEmptyContacts,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.contacts.length, 0);
      return lastPage.contacts.length === CONTACTS_PAGE_SIZE && loaded < lastPage.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (query.isError) {
      toast.error(translateBackendError(query.error, t), {
        id: 'contacts-load-error',
        description: t('errorLoadContacts'),
      });
    }
  }, [query.isError, query.error, t]);

  // Видимый признак идущего поиска: пока debounced-запрос выполняется,
  // держим loading-тост снизу (тот же слот, что и прогресс синхронизации).
  useEffect(() => {
    if (query.isFetching && debouncedSearch.trim() !== '') {
      toast.loading(t('searchInProgress'), { id: 'search-progress-toast', duration: Infinity });
    } else {
      toast.dismiss('search-progress-toast');
    }
  }, [query.isFetching, debouncedSearch, t]);

  const contacts = useMemo(() => query.data?.pages.flatMap((page) => page.contacts) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  return {
    contacts,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: () => void query.fetchNextPage(),
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    limitReached: total > contacts.length && !query.hasNextPage,
  };
}
