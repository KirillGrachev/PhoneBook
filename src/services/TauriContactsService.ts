import { contactsApi } from '@/api/directory';
import { resolveEnterpriseOrgs } from '@/lib/orgGroups';
import type { EmployeeDto, SearchParamsDto } from '@/api/contracts';
import type { Contact } from '@/types';
import { useAppStore } from '@/store/useAppStore';

import type { ContactsPage, ContactsQuery, ContactsService } from './ContactsService';

/** Employee (DTO бэкенда) → Contact (модель UI). */
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
    // TrueConf ID живёт в AD-атрибуте pager (см. contracts.EmployeeDto) и
    // используется КАК ЕСТЬ: значение уже содержит домен TrueConf-сервера
    // (`login@kma-meet.metholding.com`) — без хвоста сервер не поймёт,
    // какой чат открыть, а короткое имя этого домена не несёт. pager пуст —
    // кнопки «В TrueConf» на карточке нет (см. ContactHeader).
    trueconfId: employee.pager?.trim() || undefined,
    office: employee.office ?? undefined,
    manager: employee.manager ?? undefined,
    managerId: employee.managerGuid ?? undefined,
  };
}

/**
 * Продуктовый источник контактов: команды Rust поверх SQLite-кэша AD.
 *
 * Поиск серверный (FTS5 + LIKE), поэтому вкладка/фильтр/строка запроса
 * транслируются в параметры `search_contacts`, а не фильтруют «всё на клиенте».
 */
export class TauriContactsService implements ContactsService {
  async search(query: ContactsQuery): Promise<ContactsPage> {
    const params: SearchParamsDto = {
      limit: query.limit ?? 0,
      offset: query.offset ?? 0,
      hideEmpty: query.hideEmpty ?? true,
    };

    if (query.activeTab === 'local') {
      const ids = query.savedIds ?? [];
      if (ids.length === 0) {
        return { contacts: [], total: 0 };
      }
      params.ids = ids;
    } else {
      if (query.activeTab === 'kmaruda') {
        // Вкладка предприятия: поиск внутри союза организаций группы,
        // отмеченной в настройках, а без группы — внутри организации первого
        // настроенного AD-подключения (по атрибуту `company`, тот же механизм,
        // что и «Фильтр по предприятию»): один источник синхронизации может
        // держать весь домен холдинга, поэтому фильтр по sourceOrg границу
        // предприятия не задаёт. sourceOrg дублируется как страховка: если ни
        // одно имя группы не совпадает ни с одним `company` в AD, бэкенд
        // откатится к источнику.
        const { ldapConfigs, orgGroups, enterpriseGroupId } = useAppStore.getState();
        const orgs = resolveEnterpriseOrgs(ldapConfigs, orgGroups, enterpriseGroupId);
        if (orgs.length > 0) {
          params.organizations = orgs;
          const primaryOrg = ldapConfigs[0]?.organization?.trim();
          if (primaryOrg) {
            params.sourceOrg = primaryOrg;
          }
        }
      } else if (query.organizations?.length) {
        // Группа фильтра по организации (глобальная версия): союз организаций.
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
    }

    const page = await contactsApi.search(params);
    return { contacts: page.items.map(mapEmployeeToContact), total: page.total };
  }

  async getById(id: string): Promise<Contact> {
    return mapEmployeeToContact(await contactsApi.getById(id));
  }

  async listOrganizations(): Promise<string[]> {
    return contactsApi.listOrganizations();
  }

  async count(): Promise<number> {
    return contactsApi.count();
  }
}
