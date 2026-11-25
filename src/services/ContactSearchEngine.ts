import type { Contact } from '@/types';

/**
 * A client-side search engine for demo mode (browser / test mode).
 *
 * In desktop mode the search runs on the backend (SQLite FTS5 with the same
 * set of techniques: initials, phone "tails", keyboard-layout switching), so
 * the engine is only needed for local mocks and is covered by unit tests.
 */
export class ContactSearchEngine {
  private static readonly EN_TO_RU: Record<string, string> = {
    q: 'й',
    w: 'ц',
    e: 'у',
    r: 'к',
    t: 'е',
    y: 'н',
    u: 'г',
    i: 'ш',
    o: 'щ',
    p: 'з',
    '[': 'х',
    ']': 'ъ',
    a: 'ф',
    s: 'ы',
    d: 'в',
    f: 'а',
    g: 'п',
    h: 'р',
    j: 'о',
    k: 'л',
    l: 'д',
    ';': 'ж',
    "'": 'э',
    z: 'я',
    x: 'ч',
    c: 'с',
    v: 'м',
    b: 'и',
    n: 'т',
    m: 'ь',
    ',': 'б',
    '.': 'ю',
    '`': 'ё',
  };

  private static readonly RU_TO_EN: Record<string, string> = Object.entries(ContactSearchEngine.EN_TO_RU).reduce<
    Record<string, string>
  >((acc, [en, ru]) => {
    acc[ru] = en;
    return acc;
  }, {});

  private static translateLayout(value: string, map: Record<string, string>): string {
    return [...value].map((char) => map[char.toLowerCase()] ?? char).join('');
  }

  match(contact: Contact, search: string): boolean {
    const query = search.trim().toLowerCase();
    if (!query) {
      return true;
    }

    const haystack = [
      contact.fullName,
      contact.jobTitle,
      contact.department,
      contact.organization,
      contact.email,
      contact.trueconfId,
      contact.office,
      contact.manager,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const phoneDigits = [contact.ipPhone, contact.fullIpPhone, contact.mobilePhone]
      .filter(Boolean)
      .map((phone) => (phone as string).replace(/\D/g, ''))
      .join(' ');

    const tokens = query.split(/\s+/).filter(Boolean);
    const variants = [
      tokens,
      tokens.map((token) => ContactSearchEngine.translateLayout(token, ContactSearchEngine.EN_TO_RU)),
      tokens.map((token) => ContactSearchEngine.translateLayout(token, ContactSearchEngine.RU_TO_EN)),
    ];

    const everyTokenIn = (list: string[]) =>
      list.every((token) => haystack.includes(token) || phoneDigits.includes(token));

    if (variants.some(everyTokenIn)) {
      return true;
    }

    // Search by digital number "tails".
    const queryDigits = query.replace(/\D/g, '');
    if (queryDigits.length >= 2 && phoneDigits.includes(queryDigits)) {
      return true;
    }

    // Search by initials: "iii" → "Ivanov Ivan Ivanovich".
    const nameParts = contact.fullName
      .toLowerCase()
      .split(/[\s-]+/)
      .filter(Boolean);
    const initials = nameParts.map((part) => part[0]).join('');
    const cleanQuery = query.replace(/[^a-zа-яё]/gi, '');
    const cleanQueryRu = ContactSearchEngine.translateLayout(cleanQuery, ContactSearchEngine.EN_TO_RU);
    if (cleanQuery && (initials.startsWith(cleanQuery) || initials.startsWith(cleanQueryRu))) {
      return true;
    }

    return false;
  }
}
