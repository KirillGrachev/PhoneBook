import { useQuery } from '@tanstack/react-query';

import { isTauri } from '@/api/backend';
import { getContactsService } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';

/** The list of organizations for the filter (DISTINCT from the cache / from mocks). */
export function useOrganizations() {
  const testMode = useAppStore((state) => state.testMode);
  return useQuery({
    queryKey: ['organizations', testMode],
    queryFn: () => getContactsService().listOrganizations(),
    // Organization lists must be fresh on every entry to the screen
    // (the filter and the group editor read the same cache): a cheap DISTINCT query
    // better than the feeling of "a list that is outdated somewhere".
    staleTime: 30_000,
    refetchOnMount: 'always',
  });
}

/** The total number of contacts in the cache — for the first-launch UX. */
export function useContactCount() {
  const testMode = useAppStore((state) => state.testMode);
  return useQuery({
    queryKey: ['contacts-count', testMode],
    queryFn: () => getContactsService().count(),
    staleTime: 30_000,
    enabled: isTauri() || testMode,
  });
}
