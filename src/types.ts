/** Directory tabs: enterprise / whole holding / favorite contacts. */
export type TabType = 'kmaruda' | 'global' | 'local';

/**
 * A contact in UI terms.
 *
 * This is NOT a backend DTO (see `@/api/contracts`) — the mapping is done by
 * the contact service. Fields are optional: AD regularly lacks
 * some attributes, and the UI must survive that.
 */
export interface Contact {
  /** objectGUID of the AD record (a stable primary key). */
  id: string;
  fullName: string;
  /** Internal IP number (short). */
  ipPhone?: string;
  /** External number for the IP phone. */
  fullIpPhone?: string;
  mobilePhone?: string;
  organization?: string;
  department?: string;
  jobTitle?: string;
  email?: string;
  /** TrueConf ID: the AD `pager` attribute as is (with the chat server domain); empty — no TrueConf button. */
  trueconfId?: string;
  office?: string;
  manager?: string;
  /** Manager GUID: clicking the manager row opens their card. */
  managerId?: string;
}
