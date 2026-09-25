import type { Contact } from '@/types';

/**
 * Демо-данные для браузерной разработки и «тестового режима».
 *
 * В продуктовом режиме (Tauri + testMode=off) источник данных — кэш
 * Active Directory; этот модуль в запросах не участвует.
 */
export const KMARUDA_ORG = 'ООО «КМАруда»';
/** Демо-организация «Глобал Строй» (константа названия). */
export const GLOBAL_STROY_ORG = 'ЗАО «Глобал Строй»';
/** Демо-организация «Рога и Копыта» (константа названия). */
export const ROGA_ORG = 'ООО «Рога и Копыта»';

/** Демо-контакты браузерного режима и тестов.
 *
 * Набор подобран так, чтобы покрывать кликабельные поля карточки:
 * пары с одинаковой должностью («Бухгалтер», «Инженер технической
 * поддержки», «Менеджер по работе с клиентами»), одинаковым кабинетом
 * («Каб. 210», «Каб. 401», «Каб. 12») и цепочки руководителей —
 * с GUID (`managerId`) и без него (фолбэк поиска по имени).
 */
export const mockContacts: Contact[] = [
  {
    id: 'mock-ivanov',
    fullName: 'Иванов Иван Иванович',
    ipPhone: '1234',
    fullIpPhone: '+7 (495) 402-12-34',
    mobilePhone: '+7 (999) 111-22-33',
    organization: KMARUDA_ORG,
    department: 'IT-отдел',
    jobTitle: 'Системный администратор',
    email: 'ivanov@kmaruda.ru',
    trueconfId: 'ivanov',
    office: 'Каб. 402',
    manager: 'Петров Пётр Петрович',
    managerId: 'mock-petrov',
  },
  {
    id: 'mock-petrov',
    fullName: 'Петров Пётр Петрович',
    ipPhone: '5678',
    fullIpPhone: '+7 (495) 402-56-78',
    mobilePhone: '+7 (999) 222-33-44',
    organization: KMARUDA_ORG,
    department: 'Бухгалтерия',
    jobTitle: 'Главный бухгалтер',
    email: 'petrov@kmaruda.ru',
    trueconfId: 'petrov',
    office: 'Каб. 210',
  },
  {
    id: 'mock-sidorova',
    fullName: 'Сидорова Мария Алексеевна',
    ipPhone: '5679',
    fullIpPhone: '+7 (495) 402-56-79',
    organization: KMARUDA_ORG,
    department: 'Бухгалтерия',
    jobTitle: 'Бухгалтер',
    email: 'sidorova@kmaruda.ru',
    trueconfId: 'sidorova',
    office: 'Каб. 212',
    manager: 'Петров Пётр Петрович',
    managerId: 'mock-petrov',
  },
  {
    id: 'mock-orlova',
    fullName: 'Орлова Ольга Павловна',
    ipPhone: '5680',
    fullIpPhone: '+7 (495) 402-56-80',
    mobilePhone: '+7 (999) 444-55-66',
    organization: KMARUDA_ORG,
    department: 'Бухгалтерия',
    jobTitle: 'Бухгалтер',
    email: 'orlova@kmaruda.ru',
    trueconfId: 'orlova',
    office: 'Каб. 210',
    manager: 'Петров Пётр Петрович',
    managerId: 'mock-petrov',
  },
  {
    id: 'mock-kuznetsov',
    fullName: 'Кузнецов Дмитрий Сергеевич',
    ipPhone: '1235',
    fullIpPhone: '+7 (495) 402-12-35',
    mobilePhone: '+7 (999) 333-44-55',
    organization: KMARUDA_ORG,
    department: 'IT-отдел',
    jobTitle: 'Инженер технической поддержки',
    email: 'kuznetsov@kmaruda.ru',
    trueconfId: 'kuznetsov',
    office: 'Каб. 401',
    manager: 'Иванов Иван Иванович',
    managerId: 'mock-ivanov',
  },
  {
    id: 'mock-gusev',
    fullName: 'Гусев Андрей Михайлович',
    ipPhone: '1236',
    fullIpPhone: '+7 (495) 402-12-36',
    mobilePhone: '+7 (999) 666-77-88',
    organization: KMARUDA_ORG,
    department: 'IT-отдел',
    jobTitle: 'Инженер технической поддержки',
    email: 'gusev@kmaruda.ru',
    trueconfId: 'gusev',
    office: 'Каб. 401',
    manager: 'Иванов Иван Иванович',
    managerId: 'mock-ivanov',
  },
  {
    id: 'mock-smirnova',
    fullName: 'Смирнова Анна Сергеевна',
    ipPhone: '9012',
    fullIpPhone: '+7 (495) 901-90-12',
    mobilePhone: '+7 (916) 555-55-55',
    organization: GLOBAL_STROY_ORG,
    department: 'Отдел кадров',
    jobTitle: 'Менеджер по персоналу',
    email: 'smirnova@globalstroy.ru',
    trueconfId: 'smirnova',
    office: 'Этаж 2, оф. 12',
    // Руководитель без GUID: демонстрирует фолбэк клика — поиск по имени.
    manager: 'Фёдоров Игорь Николаевич',
  },
  {
    id: 'mock-fedorov',
    fullName: 'Фёдоров Игорь Николаевич',
    ipPhone: '9013',
    mobilePhone: '+7 (916) 777-88-99',
    organization: GLOBAL_STROY_ORG,
    department: 'Отдел снабжения',
    jobTitle: 'Руководитель отдела снабжения',
    email: 'fedorov@globalstroy.ru',
    trueconfId: 'fedorov',
  },
  {
    id: 'mock-sidorov',
    fullName: 'Сидоров Алексей Владимирович',
    ipPhone: '4321',
    fullIpPhone: '+7 (812) 432-12-34',
    mobilePhone: '+7 (981) 123-45-67',
    organization: ROGA_ORG,
    department: 'Отдел продаж',
    jobTitle: 'Директор по продажам',
    email: 'sidorov@rogaikopyta.ru',
    trueconfId: 'sidorov_av',
    office: 'Каб. 1',
  },
  {
    id: 'mock-volkova',
    fullName: 'Волкова Екатерина Дмитриевна',
    ipPhone: '4322',
    organization: ROGA_ORG,
    department: 'Отдел продаж',
    jobTitle: 'Менеджер по работе с клиентами',
    email: 'volkova@rogaikopyta.ru',
    trueconfId: 'volkova',
    office: 'Каб. 12',
    manager: 'Сидоров Алексей Владимирович',
    managerId: 'mock-sidorov',
  },
  {
    id: 'mock-zaytseva',
    fullName: 'Зайцева Анна Игоревна',
    ipPhone: '4323',
    fullIpPhone: '+7 (812) 432-12-35',
    mobilePhone: '+7 (981) 222-33-44',
    organization: ROGA_ORG,
    department: 'Отдел продаж',
    jobTitle: 'Менеджер по работе с клиентами',
    email: 'zaytseva@rogaikopyta.ru',
    trueconfId: 'zaytseva',
    office: 'Каб. 12',
    manager: 'Сидоров Алексей Владимирович',
    managerId: 'mock-sidorov',
  },
];

/** Список демо-организаций. */
export const mockOrganizations: string[] = [
  ...new Set(mockContacts.map((contact) => contact.organization).filter((org): org is string => Boolean(org))),
].sort((a, b) => a.localeCompare(b, 'ru'));
