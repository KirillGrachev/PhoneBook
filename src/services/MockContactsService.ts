import { ApiError } from '@/api/backend';
import type { Contact } from '@/types';

import { resolveDirectoryScope, resolveEnterpriseOrgs } from '@/lib/orgGroups';
import { useAppStore } from '@/store/useAppStore';

import { ContactSearchEngine } from './ContactSearchEngine';
import type { ContactsPage, ContactsQuery, ContactsService } from './ContactsService';
import { mockContacts, mockOrganizations } from './mockData';

const DEMO_DELAY_MS = 150;
const RU_COLLATOR = new Intl.Collator('ru');

/**
 * Demo contact source: browser development and "test mode".
 * The behavior (tab filters, search, sorting) intentionally repeats
 * the server semantics so that switching modes does not break the UI.
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
        // In test mode we also respect the star: with no group selected
        // demo contacts are not substituted; with a group - filter by its
        // organizations. Real LDAP connections are ignored in this case.
        const { testMode, ldapConfigs, orgGroups, enterpriseGroupId } = useAppStore.getState();
        const scope = resolveDirectoryScope(testMode, ldapConfigs, orgGroups, enterpriseGroupId);
        const orgs = resolveEnterpriseOrgs(scope.ldapConfigs, scope.groups, scope.enterpriseGroupId);
        if (orgs.length === 0) {
          return { contacts: [], total: 0 };
        }
        const allowed = new Set(orgs);
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
      if (query.title) {
        list = list.filter((contact) => contact.jobTitle === query.title);
      }
      if (query.office) {
        list = list.filter((contact) => contact.office === query.office);
      }
    }

    // Text search also works in "My contacts": starred contacts are
    // a subset of the lookup, but the search bar must filter it.
    const text = query.search?.trim();
    if (text) {
      list = list.filter((contact) => this.engine.match(contact, text));
    }

    // "Cyrillic first": service accounts with Latin letters do not rise to the top.
    if (query.hideEmpty !== false) {
      list = list.filter((c) => c.email || c.mobilePhone || c.ipPhone || c.fullIpPhone);
    }

    list.sort((a, b) => {
      const group = (name: string) => (/^[а-яё]/i.test(name) ? 0 : 1);
      const delta = group(a.fullName) - group(b.fullName);
      return delta !== 0 ? delta : RU_COLLATOR.compare(a.fullName, b.fullName);
    });
    const offset = query.offset ?? 0;
    const limit = query.limit && query.limit > 0 ? query.limit : list.length - offset;
    return delay({ contacts: list.slice(offset, offset + limit), total: list.length }, DEMO_DELAY_MS);
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

  async getPhoto(): Promise<string | null> {
    // Demo contacts have no AD photo; the UI falls back to a letter avatar.
    return null;
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
