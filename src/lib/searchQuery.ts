/** The "query looks like a phone number" flag: digits and phone punctuation. */
export function isPhoneQuery(search: string): boolean {
  const trimmed = search.trim();
  if (!trimmed) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 2 && /^[\d\s()+.-]+$/.test(trimmed);
}
