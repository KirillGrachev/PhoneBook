/**
 * Подписка на события бэкенда с корректной асинхронной отпиской.
 *
 * `listen()` возвращает промис функции отписки; наивный код теряет unlisten
 * при быстром unmount (утечка подписок). Здесь промис «догоняется» флагом
 * disposed — отписка гарантирована в любом порядке.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { isTauri } from './backend';
import type { SyncEventDto } from './contracts';

/** Имя Tauri-события прогресса синхронизации. */
export const SYNC_EVENT_NAME = 'directory-sync';

/** Подписка на события синхронизации. Возвращает функцию отписки. */
export function onSyncEvent(handler: (event: SyncEventDto) => void): () => void {
  if (!isTauri()) {
    return () => {};
  }

  let unlisten: UnlistenFn | undefined;
  let disposed = false;

  listen<SyncEventDto>(SYNC_EVENT_NAME, (event) => handler(event.payload))
    .then((unlistenFn) => {
      if (disposed) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    })
    .catch((error) => console.warn('[events] не удалось подписаться на directory-sync', error));

  return () => {
    disposed = true;
    unlisten?.();
  };
}
