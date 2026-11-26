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
/** The result batch size: the list loads while scrolling, not all at once. */
export const CONTACTS_PAGE_SIZE = 300;

/** Return value of the list hook: contacts, totals and state flags. */
export interface ContactsListResult {
  contacts: Contact[];
  /** The exact total number of matches (not limited by the page). */
  total: number;
  isLoading: boolean;
  isFetching: boolean;
  /**
   * A search term is entered but its result is not known yet: the debounce
   * has not fired, the query is in flight, or stale placeholder data is shown.
   * The UI keeps the "Start searching" hint instead of flashing "No matches"
   * before the backend has actually answered.
   */
  isSearchPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** The result ceiling is reached — suggest the user refine the query. */
  limitReached: boolean;
}

/**
 * The contact list of the current tab with server-side search.
 *
 * * the search string is debounced, the request goes to the backend (SQLite FTS);
 * * the result is paginated: the first page is 300 records, the rest are
 * loaded as a list while scrolling (`useInfiniteQuery`); the whole directory is not
 * transferred and parsed;
 * * a query that looks like a phone number searches the whole directory
 * independent of the tab and organization filters: a number does not "belong" to a tab, and
 * switching tabs would only complicate the search;
 * * "My contacts" are fetched by an exact selection of saved ids;
 * * errors are propagated to the UI (state + toast), not swallowed;
 * * `keepPreviousData` removes list flicker while more characters are typed.
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
  // The star in "Organization groups" changes the enterprise selection; the query key
  // must change, otherwise React Query returns the old cache until restart.
  const enterpriseGroupId = useAppStore((state) => state.enterpriseGroupId);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);

  // Stable key for starred contacts: rerender only when the set actually changes.
  const savedKey = useMemo(
    () => (activeTab === 'local' ? [...savedContactIds].sort().join('|') : ''),
    [activeTab, savedContactIds],
  );

  // The organization union of the selected group is stable between renders.
  const groupKey = useMemo(
    () => (selectedGroupOrgs ? [...selectedGroupOrgs].sort().join('|') : ''),
    [selectedGroupOrgs],
  );

  // A phone number is searched across the whole directory: tabs and organization filters
  // are disabled so the user does not have to guess the tab.
  const phoneSearch = isPhoneQuery(debouncedSearch);
  const effectiveTab: TabType = phoneSearch ? 'global' : activeTab;
  const effectiveOrg = phoneSearch ? null : selectedOrg;
  const effectiveGroupKey = phoneSearch ? '' : groupKey;
  // We do not show the whole directory on entry: a request goes out only when there is a
  // non-empty search or an explicitly selected organization/group. "My contacts"
  // remain a separate exception - there the set is already limited to starred contacts.
  const hasExplicitScope = activeTab === 'local' || Boolean(selectedOrg?.trim()) || Boolean(selectedGroupOrgs?.length);
  const hasQuery = debouncedSearch.trim() !== '' || hasExplicitScope;

  const query = useInfiniteQuery({
    enabled: hasQuery,
    queryKey: [
      'contacts',
      'search',
      {
        activeTab: effectiveTab,
        search: debouncedSearch,
        selectedOrg: effectiveOrg,
        groupKey: effectiveGroupKey,
        enterpriseGroupId,
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

  // A visible sign of an ongoing search: while the debounced request runs,
  // keep the loading toast at the bottom (the same slot as sync progress).
  useEffect(() => {
    if (query.isFetching && debouncedSearch.trim() !== '') {
      toast.loading(t('searchInProgress'), { id: 'search-progress-toast', duration: Infinity });
    } else {
      toast.dismiss('search-progress-toast');
    }
  }, [query.isFetching, debouncedSearch, t]);

  const contacts = useMemo(
    () => (hasQuery ? (query.data?.pages.flatMap((page) => page.contacts) ?? []) : []),
    [hasQuery, query.data],
  );
  const total = hasQuery ? (query.data?.pages[0]?.total ?? 0) : 0;

  // The result for the current input is not known yet while the debounce lags
  // behind the raw search string, or the query for it is still loading/fetching
  // (including keepPreviousData placeholders). Only once it settles may the UI
  // claim "no matches".
  const isSearchPending =
    search.trim() !== debouncedSearch.trim() || (hasQuery && (query.isLoading || query.isPlaceholderData));

  return {
    contacts,
    total,
    isLoading: hasQuery && query.isLoading,
    isFetching: hasQuery && query.isFetching,
    isSearchPending,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: () => void query.fetchNextPage(),
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    limitReached: total > contacts.length && !query.hasNextPage,
  };
}
