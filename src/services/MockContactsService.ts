import { ApiError } from '@/api/backend';
import type { Contact } from '@/types';

import { resolveEnterpriseOrgs } from '@/lib/orgGroups';
import { useAppStore } from '@/store/useAppStore';

import { ContactSearchEngine } from './ContactSearchEngine';
import type { ContactsPage, ContactsQuery, ContactsService } from './ContactsService';
import { KMARUDA_ORG, mockContacts, mockOrganizations } from './mockData';

const DEMO_DELAY_MS = 150;
const RU_COLLATOR = new Intl.Collator('ru');

/**
 * Демо-источник контактов: браузерная разработка и «тестовый режим».
 * Поведение (фильтры вкладок, поиск, сортировка) намеренно повторяет
 * серверную семантику, чтобы переключение режимов не ломало UI.
 */
export class MockContactsService implements ContactsService {
  private readonly engine = new ContactSearchEngine();

  async search(query: ContactsQuery): Promise<ContactsPage> {
    let list = [...mockContacts];

    if (query.activeTab === 'local') {
      const saved = new Set(query.savedIds ?? []);
      list = list.filter((contact) => saved.has(contact.id));
    } else {
      if (query.activeTab === 'kmaruda') {
        // Семантика боевого сервиса: союз организаций группы предприятия,
        // без группы и настроек AD — демо-организация комбината.
        const { ldapConfigs, orgGroups, enterpriseGroupId } = useAppStore.getState();
        const orgs = resolveEnterpriseOrgs(ldapConfigs, orgGroups, enterpriseGroupId);
        const allowed = new Set(orgs.length > 0 ? orgs : [KMARUDA_ORG]);
        list = list.filter((contact) => contact.organization && allowed.has(contact.organization));
      } else if (query.organizations?.length) {
        const allowed = new Set(query.organizations);
        list = list.filter((contact) => contact.organization && allowed.has(contact.organization));
      } else if (query.organization) {
        list = list.filter((contact) => contact.organization === query.organization);
      }
      if (query.department) {
        list = list.filter((contact) => contact.department === query.department);
      }
      if (query.search?.trim()) {
        list = list.filter((contact) => this.engine.match(contact, query.search as string));
      }
    }

    // «Кириллица сначала»: служебные учётки с латиницей не поднимаются наверх.
    if (query.hideEmpty !== false) {
      list = list.filter((c) => c.email || c.mobilePhone || c.ipPhone || c.fullIpPhone);
    }

    list.sort((a, b) => {
      const group = (name: string) => (/^[а-яё]/i.test(name) ? 0 : 1);
      const delta = group(a.fullName) - group(b.fullName);
      return delta !== 0 ? delta : RU_COLLATOR.compare(a.fullName, b.fullName);
    });
    const limit = query.limit && query.limit > 0 ? query.limit : list.length;
    return delay({ contacts: list.slice(0, limit), total: list.length }, DEMO_DELAY_MS);
  }

  async getById(id: string): Promise<Contact> {
    const contact = mockContacts.find((item) => item.id === id);
    if (!contact) {
      throw new ApiError({
        code: 'NOT_FOUND',
        message: 'Контакт не найден в справочнике или был удалён',
      });
    }
    return delay(contact, 80);
  }

  async listOrganizations(): Promise<string[]> {
    return delay(mockOrganizations, 50);
  }

  async count(): Promise<number> {
    return mockContacts.length;
  }
}

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}
