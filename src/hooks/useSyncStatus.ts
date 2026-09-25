import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { syncApi } from '@/api/directory';
import { onSyncEvent } from '@/api/events';
import type { OrgSyncStateDto } from '@/api/contracts';
import { useAppStore } from '@/store/useAppStore';
import { useContactCount } from '@/hooks/useDirectory';

/** Снимок статуса синхронизации для UI. */
export interface SyncState {
  /** Идёт ли синхронизация прямо сейчас (live-события + статус бэкенда). */
  running: boolean;
  /** Сколько записей загружено в текущем прогоне (для прогресса). */
  fetched: number;
  organizations: OrgSyncStateDto[];
}

/** Ключи react-query, инвалидируемые после завершения синхронизации. */
const SYNC_TOAST_ID = 'sync-status-toast';

/** Кэши справочника, устаревающие после синхронизации и загрузки внешних файлов. */
export const DIRECTORY_QUERY_KEYS = [
  ['contacts'],
  ['contact'],
  ['organizations'],
  ['contacts-count'],
  ['sync-status'],
] as const;

/**
 * Сводный статус фоновой синхронизации AD.
 *
 * Комбинирует периодический опрос `get_sync_status` с live-событиями
 * канала `directory-sync`: UI реагирует мгновенно, а опрос страхует
 * от пропущенных событий (перезапуск окна и т.п.).
 */
export function useSyncStatus(): SyncState {
  const queryClient = useQueryClient();
  const testMode = useAppStore((state) => state.testMode);
  const enabled = isTauri() && !testMode;

  const { t } = useTranslation();
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

  // Первый прогон (кэш пуст) показывает полноэкранный экран синхронизации —
  // дублировать его тостом снизу не нужно; тосты остаются для фоновых
  // синхронизаций, когда большого экрана нет.
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
          // Ошибка синхронизации — тост снизу (единый стиль уведомлений),
          // детали по организациям остаются в настройках AD.
          toast.dismiss(SYNC_TOAST_ID);
          toast.error(event.message || t('errorLoadContacts'), {
            id: 'sync-error-toast',
            duration: 8000,
          });
          break;
        case 'finished':
          setLive((prev) => ({ ...prev, fetched: event.count ?? prev.fetched }));
          if (toastsEnabledRef.current) {
            toast.success(t('sync.finished', { count: event.count ?? 0, org: event.organization ?? '' }), {
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
  }, [enabled, queryClient, t]);

  const organizations = useMemo(() => status?.organizations ?? [], [status]);
  const running = enabled && (live.running || (status?.running ?? false));

  return { running, fetched: live.fetched, organizations };
}
