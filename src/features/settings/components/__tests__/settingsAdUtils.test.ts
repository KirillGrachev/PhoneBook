import { describe, expect, it } from 'vitest';

import type { LdapOrgConfigDto } from '@/api/contracts';

import { toInput, urlScheme } from '../settingsAdUtils';

describe('settingsAdUtils', () => {
  it('определяет схему LDAP-URL', () => {
    expect(urlScheme(' LDAPS://dc1.example.ru:636 ')).toBe('ldaps');
    expect(urlScheme('ldap://dc1.example.ru')).toBe('ldap');
    expect(urlScheme('https://dc1.example.ru')).toBeNull();
    expect(urlScheme('')).toBeNull();
  });

  it('преобразует конфиг в input без пароля', () => {
    const config: LdapOrgConfigDto = {
      organization: 'KMA',
      ldapUrl: 'ldaps://dc1',
      baseDn: 'DC=kma,DC=ru',
      bindDn: 'svc@kma.ru',
      useStartTls: false,
      allowInvalidTls: true,
      useIntegratedAuth: false,
      hasPassword: true,
    };
    expect(toInput(config)).toEqual({
      organization: 'KMA',
      ldapUrl: 'ldaps://dc1',
      baseDn: 'DC=kma,DC=ru',
      bindDn: 'svc@kma.ru',
      useStartTls: false,
      allowInvalidTls: true,
      useIntegratedAuth: false,
    });
  });
});
