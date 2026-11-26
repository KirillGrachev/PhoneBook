import { isTauri } from '@/api/backend';
import type { Contact, TabType } from '@/types';
import { useAppStore } from '@/store/useAppStore';

import { MockContactsService } from './MockContactsService';
import { TauriContactsService } from './TauriContactsService';
import { ApiError } from '@/api/backend';

/** Contact selection parameters in domain terms. */
export interface ContactsQuery {
  activeTab: TabType;
  /** An already debounced search string. */
  search?: string;
  organization?: string | null;
  /** The union of organizations (a filter group): replaces a single filter. */
  organizations?: string[] | null;
  department?: string | null;
  /** A job title filter (clicking a title in the card). */
  title?: string | null;
  /** An office filter (clicking an office in the card). */
  office?: string | null;
  /** Identifiers of favorite contacts (the "My contacts" tab). */
  savedIds?: string[];
  limit?: number;
  /** The result batch offset (paginated list loading). */
  offset?: number;
  /** Hide accounts without email and phones. */
  hideEmpty?: boolean;
}

/**
 * The contact source contract.
 *
 * Three implementations:
 * * {@link TauriContactsService} — local Active Directory cache (SQLite);
 * * {@link MockContactsService} — demo data (test mode / browser);
 * * {@link BrowserLockedService} — browser WITHOUT test mode: no data,
 *   the UI explains the reason and offers to enable test mode.
 *
 * Errors MUST be propagated upward (no "silent" empty lists):
 * react-query shows them to the user and allows retrying the request.
 */
/** Selection result: page contacts + the exact total. */
export interface ContactsPage {
  contacts: Contact[];
  total: number;
}

/** The contact service contract: mock and production implementations. */
export interface ContactsService {
  search(query: ContactsQuery): Promise<ContactsPage>;
  getById(id: string): Promise<Contact>;
  /** Avatar as a `data:` URL, or `null` when the contact has no photo. */
  getPhoto(id: string): Promise<string | null>;
  listOrganizations(): Promise<string[]>;
  count(): Promise<number>;
}

/**
 * Running in the browser with test mode off: Active Directory
 * is unavailable outside the desktop app, the user did not enable demo data —
 * so the directory is empty ON PURPOSE, with a clear explanation in the UI.
 */
class BrowserLockedService implements ContactsService {
  async search(): Promise<ContactsPage> {
    return { contacts: [], total: 0 };
  }

  async getById(): Promise<Contact> {
    throw new ApiError({
      code: 'NOT_RUNNING_IN_DESKTOP',
      message: 'Данные справочника доступны только в десктоп-приложении',
    });
  }

  async getPhoto(): Promise<string | null> {
    return null;
  }

  async listOrganizations(): Promise<string[]> {
    return [];
  }

  async count(): Promise<number> {
    return 0;
  }
}

const tauriService = new TauriContactsService();
const mockService = new MockContactsService();
const browserLockedService = new BrowserLockedService();

/**
 * The provider is chosen on every call (not cached as a singleton):
 * test mode can be toggled at runtime, and a browser launch
 * differs from the desktop one by the absence of a Tauri environment.
 */
export function getContactsService(): ContactsService {
  const testMode = useAppStore.getState().testMode;
  if (testMode) {
    return mockService;
  }
  return isTauri() ? tauriService : browserLockedService;
}

/** Demo mode: mock data instead of AD. */
export function isMockMode(): boolean {
  return useAppStore.getState().testMode;
}

/** Running in the browser without test mode (the directory is intentionally empty). */
export function isBrowserLocked(): boolean {
  return !isTauri() && !useAppStore.getState().testMode;
}
