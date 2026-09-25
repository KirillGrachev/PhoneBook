/** Признак «запрос похож на номер телефона»: цифры и телефонная пунктуация. */
export function isPhoneQuery(search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 2 && /^[\d\s()+.-]+$/.test(trimmed);
}
