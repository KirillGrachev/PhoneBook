import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { syncApi } from '@/api/directory';
import { onSyncEvent } from '@/api/events';
import type { OrgSyncStateDto } from '@/api/contracts';
import { personNameForLanguage } from '@/lib/transliteration';
import { useAppStore } from '@/store/useAppStore';
import { useContactCount } from '@/hooks/useDirectory';

/** A synchronization status snapshot for the UI. */
export interface SyncState {
  /** Whether synchronization is running right now (live events + backend status). */
  running: boolean;
  /** How many records are loaded in the current run (for progress). */
  fetched: number;
  organizations: OrgSyncStateDto[];
}

/** react-query keys invalidated after synchronization completes. */
const SYNC_TOAST_ID = 'sync-status-toast';

/** Directory caches that become stale after sync and external file loading. */
export const DIRECTORY_QUERY_KEYS = [
  ['contacts'],
  ['contact'],
  ['organizations'],
  ['contacts-count'],
  ['sync-status'],
] as const;

/**
 * Aggregated status of the background AD synchronization.
 *
 * Combines periodic polling of `get_sync_status` with live events
 * of the `directory-sync` channel: the UI reacts instantly, and polling backs it up
 * against missed events (window restart, etc.).
 */
export function useSyncStatus(): SyncState {
  const queryClient = useQueryClient();
  const testMode = useAppStore((state) => state.testMode);
  const enabled = isTauri() && !testMode;

  const { t, i18n } = useTranslation();
  const { data: status } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => syncApi.status(),
    enabled,
    staleTime: 30_000,
    refetchOnMount: 'always',
  });

  const [live, setLive] = useState<{ running: boolean; fetched: number }>({
    running: false,
    fetched: 0,
  });

  // The first run (empty cache) shows a full-screen synchronization screen —
  // no need to duplicate it with a bottom toast; toasts remain for background
  // syncs when there is no large screen.
  const { data: contactCount } = useContactCount();
  const countRef = useRef(contactCount ?? 0);
  countRef.current = contactCount ?? 0;
  const toastsEnabledRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return onSyncEvent((event) => {
      switch (event.state) {
        case 'started':
          setLive((prev) => ({ ...prev, running: true, fetched: 0 }));
          toastsEnabledRef.current = countRef.current > 0;
          if (toastsEnabledRef.current) {
            toast.loading(t('sync.running'), { id: SYNC_TOAST_ID, duration: Infinity });
          }
          break;
        case 'progress':
          setLive((prev) => ({ ...prev, fetched: event.fetched ?? prev.fetched }));
          if (toastsEnabledRef.current) {
            toast.loading(t('sync.progress', { count: event.fetched ?? 0 }), {
              id: SYNC_TOAST_ID,
              duration: Infinity,
            });
          }
          break;
        case 'error':
          // A synchronization error is a toast at the bottom (a unified notification style),
          // organization details remain in the AD settings.
          toast.dismiss(SYNC_TOAST_ID);
          toast.error(event.message || t('errorLoadContacts'), {
            id: 'sync-error-toast',
            duration: 8000,
          });
          break;
        case 'finished':
          setLive((prev) => ({ ...prev, fetched: event.count ?? prev.fetched }));
          if (toastsEnabledRef.current) {
            // The organization name comes from AD in Russian. In the English
            // locale we show it using the same transliteration rules as
            // contact names, so the notification is not half Russian.
            const organization = personNameForLanguage(event.organization ?? '', i18n.language);
            toast.success(t('sync.finished', { count: event.count ?? 0, org: organization }), {
              id: SYNC_TOAST_ID,
              duration: 4000,
            });
          }
          break;
        case 'runFinished':
          setLive((prev) => ({ ...prev, running: false, fetched: 0 }));
          toast.dismiss(SYNC_TOAST_ID);
          for (const key of DIRECTORY_QUERY_KEYS) {
            void queryClient.invalidateQueries({ queryKey: [...key] });
          }
          break;
      }
    });
  }, [enabled, queryClient, t, i18n.language]);

  const organizations = useMemo(() => status?.organizations ?? [], [status]);
  const running = enabled && (live.running || (status?.running ?? false));

  return { running, fetched: live.fetched, organizations };
}
