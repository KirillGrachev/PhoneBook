/**
 * Subscription to backend events with correct asynchronous unsubscription.
 *
 * `listen()` returns a promise of an unsubscribe function; naive code loses the unlisten
 * on a fast unmount (subscription leak). Here the promise is "caught up" with a flag
 * disposed — unsubscription is guaranteed in any order.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { isTauri } from './backend';
import type { SyncEventDto } from './contracts';

/** The name of the Tauri synchronization progress event. */
export const SYNC_EVENT_NAME = 'directory-sync';

/** Subscription to synchronization events. Returns an unsubscribe function. */
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
    .catch((error) => console.warn('[events] failed to subscribe to directory-sync', error));

  return () => {
    disposed = true;
    unlisten?.();
  };
}
