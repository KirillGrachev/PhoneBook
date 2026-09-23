import { useQuery } from '@tanstack/react-query';

import { isTauri } from '@/api/backend';
import { getContactsService } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';

/** Список организаций для фильтра (DISTINCT из кэша / из моков). */
export function useOrganizations() {
  const testMode = useAppStore((state) => state.testMode);
  return useQuery({
    queryKey: ['organizations', testMode],
    queryFn: () => getContactsService().listOrganizations(),
    // Списки организаций должны быть свежими на каждом входе в экран
    // (фильтр и редактор групп читают один кэш): дешёвый DISTINCT-запрос
    // лучше ощущения «где-то неактуальный список».
    staleTime: 30_000,
    refetchOnMount: 'always',
  });
}

/** Общее число контактов в кэше — для UX первого запуска. */
export function useContactCount() {
  const testMode = useAppStore((state) => state.testMode);
  return useQuery({
    queryKey: ['contacts-count', testMode],
    queryFn: () => getContactsService().count(),
    staleTime: 30_000,
    enabled: isTauri() || testMode,
  });
}
