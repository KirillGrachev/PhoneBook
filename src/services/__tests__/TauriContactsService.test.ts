import { describe, expect, it } from 'vitest';

import { mapEmployeeToContact } from '@/services/TauriContactsService';
import type { EmployeeDto } from '@/api/contracts';

function employee(pager: string | null): EmployeeDto {
  return {
    objectGuid: 'g1',
    sourceOrg: 'КМАруда',
    samAccountName: 'makevnin_va',
    firstName: 'Владимир',
    lastName: 'Макевнин',
    middleName: null,
    displayName: 'Макевнин Владимир',
    title: 'Специалист',
    department: 'IT',
    company: 'КМАруда',
    office: null,
    email: 'makevnin_va@kmaruda.ru',
    ipPhone: '1234',
    phoneExternal: null,
    phoneMobile: null,
    manager: null,
    pager,
    usnChanged: null,
    updatedAt: null,
  };
}

describe('mapEmployeeToContact: TrueConf ID из AD pager', () => {
  it('берёт pager как есть, вместе с доменом TrueConf-сервера', () => {
    const contact = mapEmployeeToContact(employee('makevnin_va@kma-meet.metholding.com'));
    expect(contact.trueconfId).toBe('makevnin_va@kma-meet.metholding.com');
  });

  it('не подменяет pager логином и не обрезает домен', () => {
    const contact = mapEmployeeToContact(employee('makevnin_va@kma-meet.metholding.com'));
    expect(contact.trueconfId).not.toBe('makevnin_va');
    expect(contact.trueconfId).toContain('@kma-meet.metholding.com');
  });

  it('trim-ит пробелы вокруг значения pager', () => {
    const contact = mapEmployeeToContact(employee('  malakhov@kma-meet.metholding.com  '));
    expect(contact.trueconfId).toBe('malakhov@kma-meet.metholding.com');
  });

  it('пустой pager → кнопки TrueConf нет (без фолбэка на логин)', () => {
    expect(mapEmployeeToContact(employee(null)).trueconfId).toBeUndefined();
    expect(mapEmployeeToContact(employee('   ')).trueconfId).toBeUndefined();
  });
});
