import { describe, expect, it } from 'vitest';

import { escapeVcard, foldLine, generateVcard, normalizePhone, splitName } from '@/lib/vcard';
import type { Contact } from '@/types';

const contact: Contact = {
  id: 'guid-1',
  fullName: 'Иванов Иван Иванович',
  ipPhone: '1234',
  fullIpPhone: '+7 (495) 123-45-67',
  mobilePhone: '8 (999) 111-22-33',
  organization: 'ООО «КМАруда»',
  department: 'IT-отдел',
  jobTitle: 'Системный администратор',
  email: 'ivanov@kmaruda.ru',
};

describe('vcard (клиентский генератор)', () => {
  it('формирует валидную структуру vCard 3.0', () => {
    const vcard = generateVcard(contact);
    expect(vcard.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(vcard.endsWith('END:VCARD')).toBe(true);
    expect(vcard).toContain('FN:Иванов Иван Иванович');
    expect(vcard).toContain('N:Иванов;Иван;Иванович;;');
    expect(vcard).toContain('ORG:ООО «КМАруда»;IT-отдел');
    expect(vcard).toContain('TEL;TYPE=CELL:+79991112233');
    expect(vcard).toContain('TEL;TYPE=WORK,VOICE:1234');
    expect(vcard).toContain('EMAIL;TYPE=INTERNET:ivanov@kmaruda.ru');
    expect(vcard).toContain('UID:guid-1');
  });

  it('экранирует спецсимволы', () => {
    expect(escapeVcard('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeVcard('line1\nline2')).toBe('line1\\nline2');
  });

  it('складывает длинные строки по границе 74 октетов', () => {
    const long = `NOTE:${'я'.repeat(60)}`;
    const folded = foldLine(long);
    for (const physical of folded.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(74);
    }
    expect(folded).toContain('\r\n ');
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('нормализует российские номера', () => {
    expect(normalizePhone('8 (999) 111-22-33')).toBe('+79991112233');
    expect(normalizePhone('79991112233')).toBe('+79991112233');
    expect(normalizePhone('+7 999 111 22 33')).toBe('+79991112233');
    expect(normalizePhone('9991112233')).toBe('+79991112233');
    expect(normalizePhone('1234')).toBe('1234');
  });

  it('разбирает ФИО на компоненты', () => {
    expect(splitName('Иванов Иван Иванович')).toEqual(['Иванов', 'Иван', 'Иванович']);
    expect(splitName('Иванов Иван')).toEqual(['Иванов', 'Иван', '']);
    expect(splitName('Псевдоним')).toEqual(['', 'Псевдоним', '']);
  });
});
