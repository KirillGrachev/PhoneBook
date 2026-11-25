import { contactsApi } from '@/api/directory';
import { resolveEnterpriseOrgs } from '@/lib/orgGroups';
import type { EmployeeDto, SearchParamsDto } from '@/api/contracts';
import type { Contact } from '@/types';
import { useAppStore } from '@/store/useAppStore';

import { ContactSearchEngine } from './ContactSearchEngine';
import type { ContactsPage, ContactsQuery, ContactsService } from './ContactsService';

/** Search over favorites: the set is small, we filter on the client. */
const localSearch = new ContactSearchEngine();

/** Monotonic request id: the backend discards stale searches. */
let nextSearchRequestId = 0;
function nextRequestId(): number {
  nextSearchRequestId += 1;
  return nextSearchRequestId;
}

/** Employee (backend DTO) → Contact (UI model). */
export function mapEmployeeToContact(employee: EmployeeDto): Contact {
  const composedName = [employee.lastName, employee.firstName, employee.middleName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');

  return {
    id: employee.objectGuid,
    fullName: employee.displayName?.trim() || composedName || employee.samAccountName || '—',
    ipPhone: employee.ipPhone ?? undefined,
    fullIpPhone: employee.phoneExternal ?? undefined,
    mobilePhone: employee.phoneMobile ?? undefined,
    organization: employee.company ?? undefined,
    department: employee.department ?? undefined,
    jobTitle: employee.title ?? undefined,
    email: employee.email ?? undefined,
    // The TrueConf ID lives in the AD pager attribute (see contracts.EmployeeDto) and is
    // used AS IS: the value already contains the TrueConf server domain
    // (`login@kma-meet.metholding.com`) - without the tail the server will not understand
    // which chat to open, and the short name does not carry that domain. pager is empty -
    // there is no "Open in TrueConf" button on the card (see ContactHeader).
    trueconfId: employee.pager?.trim() || undefined,
    office: employee.office ?? undefined,
    manager: employee.manager ?? undefined,
    managerId: employee.managerGuid ?? undefined,
  };
}

/**
 * The production contact source: Rust commands over the SQLite AD cache.
 *
 * The search is server-side (FTS5 + LIKE), so the tab/filter/query string
 * are translated into `search_contacts` parameters, not filtering "everything on the client".
 */
export class TauriContactsService implements ContactsService {
  async search(query: ContactsQuery): Promise<ContactsPage> {
    if (query.activeTab === 'local') {
      const ids = query.savedIds ?? [];
      if (ids.length === 0) {
        return { contacts: [], total: 0 };
      }
      // We take the whole favorite set (ids is limited by the command layer),
      // then apply text search and only then the page.
      const page = await contactsApi.search({
        ids,
        limit: ids.length,
        offset: 0,
        hideEmpty: false,
        requestId: nextRequestId(),
      });
      let contacts = page.items.map(mapEmployeeToContact);
      const text = query.search?.trim();
      if (text) {
        contacts = contacts.filter((contact) => localSearch.match(contact, text));
      }
      if (query.hideEmpty !== false) {
        contacts = contacts.filter(
          (contact) => contact.email || contact.mobilePhone || contact.ipPhone || contact.fullIpPhone,
        );
      }
      const total = contacts.length;
      const offset = query.offset ?? 0;
      const limit = query.limit && query.limit > 0 ? query.limit : total;
      return { contacts: contacts.slice(offset, offset + limit), total };
    }

    const params: SearchParamsDto = {
      limit: query.limit && query.limit > 0 ? query.limit : 300,
      offset: query.offset ?? 0,
      hideEmpty: query.hideEmpty ?? true,
      requestId: nextRequestId(),
    };

    if (query.activeTab === 'kmaruda') {
      // The enterprise tab works only by the starred group.
      // With no group selected we return empty: we must not substitute the first
      // AD connection or hand out the whole holding source.
      const { ldapConfigs, orgGroups, enterpriseGroupId } = useAppStore.getState();
      const orgs = resolveEnterpriseOrgs(ldapConfigs, orgGroups, enterpriseGroupId);
      if (orgs.length === 0) {
        return { contacts: [], total: 0 };
      }
      params.organizations = orgs;
    } else if (query.organizations?.length) {
      // The organization filter group (global version): the union of organizations.
      params.organizations = query.organizations;
    } else if (query.organization) {
      params.organization = query.organization;
    }

    if (query.department) {
      params.department = query.department;
    }
    if (query.title) {
      params.title = query.title;
    }
    if (query.office) {
      params.office = query.office;
    }
    if (query.search?.trim()) {
      params.query = query.search.trim();
    }

    const page = await contactsApi.search(params);
    return { contacts: page.items.map(mapEmployeeToContact), total: page.total };
  }

  async getById(id: string): Promise<Contact> {
    return mapEmployeeToContact(await contactsApi.getById(id));
  }

  async getPhoto(id: string): Promise<string | null> {
    return contactsApi.getPhoto(id);
  }

  async listOrganizations(): Promise<string[]> {
    return contactsApi.listOrganizations();
  }

  async count(): Promise<number> {
    return contactsApi.count();
  }
}
