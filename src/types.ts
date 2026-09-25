/** Вкладки справочника: предприятие / весь холдинг / избранные контакты. */
export type TabType = 'kmaruda' | 'global' | 'local';

/**
 * Контакт в терминах UI.
 *
 * Это НЕ DTO бэкенда (см. `@/api/contracts`) — маппинг выполняет
 * сервис контактов. Поля опциональны: в AD регулярно отсутствуют
 * те или иные атрибуты, и UI обязан это переживать.
 */
export interface Contact {
  /** objectGUID записи AD (стабильный первичный ключ). */
  id: string;
  fullName: string;
  /** Внутренний IP-номер (короткий). */
  ipPhone?: string;
  /** Внешний номер для IP-телефона. */
  fullIpPhone?: string;
  mobilePhone?: string;
  organization?: string;
  department?: string;
  jobTitle?: string;
  email?: string;
  /** TrueConf ID: AD-атрибут `pager` как есть (с доменом сервера чатов); пусто — кнопки TrueConf нет. */
  trueconfId?: string;
  office?: string;
  manager?: string;
  /** GUID руководителя: клик по строке руководителя открывает его карточку. */
  managerId?: string;
}
