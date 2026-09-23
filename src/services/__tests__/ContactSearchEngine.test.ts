import { describe, expect, it } from 'vitest';

import { ContactSearchEngine } from '@/services/ContactSearchEngine';
import { KMARUDA_ORG } from '@/services/mockData';
import type { Contact } from '@/types';

const engine = new ContactSearchEngine();

const contact: Contact = {
  id: 'g1',
  fullName: 'Иванов Иван Иванович',
  ipPhone: '1234',
  fullIpPhone: '+7 (495) 123-45-67',
  mobilePhone: '+7 (999) 111-22-33',
  organization: KMARUDA_ORG,
  department: 'IT-отдел',
  jobTitle: 'Системный администратор',
  email: 'ivanov@kmaruda.ru',
  trueconfId: 'ivanov',
};

describe('ContactSearchEngine', () => {
  it('находит по подстроке ФИО', () => {
    expect(engine.match(contact, 'иван')).toBe(true);
    expect(engine.match(contact, 'ИВАНОВ')).toBe(true);
  });

  it('находит по должности, отделу и почте', () => {
    expect(engine.match(contact, 'администратор')).toBe(true);
    expect(engine.match(contact, 'it-отдел')).toBe(true);
    expect(engine.match(contact, 'kmaruda')).toBe(true);
  });

  it('находит по хвосту телефона без учёта форматирования', () => {
    expect(engine.match(contact, '45-67')).toBe(true);
    expect(engine.match(contact, '2233')).toBe(true);
    expect(engine.match(contact, '9999')).toBe(false);
  });

  it('находит при ошибочной английской раскладке', () => {
    // «bdfy» — «иван» в английской раскладке.
    expect(engine.match(contact, 'bdfy')).toBe(true);
  });

  it('находит при ошибочной русской раскладке', () => {
    // «ivanov» → «шмфтщм» в русской раскладке.
    expect(engine.match(contact, 'шмфтщм')).toBe(true);
  });

  it('находит по инициалам', () => {
    expect(engine.match(contact, 'иии')).toBe(true);
    // «bbb» — те же инициалы, набранные в английской раскладке.
    expect(engine.match(contact, 'bbb')).toBe(true);
    expect(engine.match(contact, 'zzz')).toBe(false);
  });

  it('все слова запроса должны совпасть', () => {
    expect(engine.match(contact, 'иванов бухгалтер')).toBe(false);
    expect(engine.match(contact, 'иванов администратор')).toBe(true);
  });

  it('пустой запрос матчит всё', () => {
    expect(engine.match(contact, '   ')).toBe(true);
  });
});
