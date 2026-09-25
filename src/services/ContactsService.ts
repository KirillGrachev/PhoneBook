import { isTauri } from '@/api/backend';
import type { Contact, TabType } from '@/types';
import { useAppStore } from '@/store/useAppStore';

import { MockContactsService } from './MockContactsService';
import { TauriContactsService } from './TauriContactsService';
import { ApiError } from '@/api/backend';

/** Параметры выборки контактов в терминах предметной области. */
export interface ContactsQuery {
  activeTab: TabType;
  /** Уже debounce-нутая строка поиска. */
  search?: string;
  organization?: string | null;
  /** Союз организаций (группа фильтров): заменяет одиночный фильтр. */
  organizations?: string[] | null;
  department?: string | null;
  /** Фильтр по должности (клик по должности в карточке). */
  title?: string | null;
  /** Фильтр по кабинету (клик по кабинету в карточке). */
  office?: string | null;
  /** Идентификаторы избранных контактов (вкладка «Мои контакты»). */
  savedIds?: string[];
  limit?: number;
  /** Смещение порции выдачи (порционная загрузка списком). */
  offset?: number;
  /** Скрывать учётки без почты и телефонов. */
  hideEmpty?: boolean;
}

/**
 * Контракт источника контактов.
 *
 * Три реализации:
 * * {@link TauriContactsService} — локальный кэш Active Directory (SQLite);
 * * {@link MockContactsService} — демо-данные (тестовый режим / браузер);
 * * {@link BrowserLockedService} — браузер БЕЗ тестового режима: данных нет,
 *   UI объясняет причину и предлагает включить тестовый режим.
 *
 * Ошибки ОБЯЗАТЕЛЬНО пробрасываются наверх (никаких «тихих» пустых списков):
 * react-query показывает их пользователю и позволяет повторить запрос.
 */
/** Результат выборки: контакты страницы + точное общее число. */
export interface ContactsPage {
  contacts: Contact[];
  total: number;
}

/** Контракт сервиса контактов: mock- и боевая имплементации. */
export interface ContactsService {
  search(query: ContactsQuery): Promise<ContactsPage>;
  getById(id: string): Promise<Contact>;
  listOrganizations(): Promise<string[]>;
  count(): Promise<number>;
}

/**
 * Запуск в браузере с выключенным тестовым режимом: Active Directory
 * недоступен вне десктоп-приложения, демо-данные пользователь не включал —
 * значит, справочник пуст ОСОЗНАННО, с понятным объяснением в UI.
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
 * Провайдер выбирается на каждый вызов (не кэшируется синглтоном):
 * тестовый режим можно переключить в рантайме, а браузерный запуск
 * отличается от десктопного отсутствием Tauri-окружения.
 */
export function getContactsService(): ContactsService {
  const testMode = useAppStore.getState().testMode;
  if (testMode) {
    return mockService;
  }
  return isTauri() ? tauriService : browserLockedService;
}

/** Демо-режим: мок-данные вместо AD. */
export function isMockMode(): boolean {
  return useAppStore.getState().testMode;
}

/** Запуск в браузере без тестового режима (справочник осознанно пуст). */
export function isBrowserLocked(): boolean {
  return !isTauri() && !useAppStore.getState().testMode;
}
