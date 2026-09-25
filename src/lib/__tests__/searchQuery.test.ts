import { describe, expect, it } from 'vitest';

import { isPhoneQuery } from '@/lib/searchQuery';

describe('isPhoneQuery', () => {
  it('recognizes phone-like queries', () => {
    expect(isPhoneQuery('1234')).toBe(true);
    expect(isPhoneQuery('+7 (495) 123-45-67')).toBe(true);
    expect(isPhoneQuery('45-67')).toBe(true);
  });

  it('does not treat names or layout punctuation as phones', () => {
    expect(isPhoneQuery('Иванов')).toBe(false);
    expect(isPhoneQuery(',')).toBe(false);
    expect(isPhoneQuery('')).toBe(false);
    expect(isPhoneQuery('Иванов 123')).toBe(false);
  });
});
