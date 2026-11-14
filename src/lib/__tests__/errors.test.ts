import { afterEach, describe, expect, it } from 'vitest';

import i18n from '@/lib/i18n';
import { translateBackendError } from '@/lib/errors';

afterEach(() => {
  document.documentElement.lang = 'ru';
});

describe('translateBackendError: язык', () => {
  it('для английского UI не подставляет русский details', () => {
    document.documentElement.lang = 'en';
    const text = translateBackendError(
      { code: 'LDAP_AUTH', message: 'Отказано в авторизации: data 52e', details: 'data 52e' },
      i18n.t.bind(i18n),
    );
    expect(text).toBe('Authentication failed');
  });

  it('для английского UI не показывает кириллицу ни для одного кода', () => {
    document.documentElement.lang = 'en';
    const codes = [
      'CONFIG_ERROR',
      'VALIDATION',
      'LDAP_UNREACHABLE',
      'LDAP_TIMEOUT',
      'LDAP_AUTH',
      'LDAP_TLS',
      'LDAP_PROTOCOL',
      'DB_ERROR',
      'EXTERNAL_FILE',
      'NOT_FOUND',
      'INTERNAL',
      'NOT_RUNNING_IN_DESKTOP',
    ];
    for (const code of codes) {
      const text = translateBackendError(
        { code, message: 'Русское сообщение', details: 'Русские детали' },
        i18n.t.bind(i18n),
      );
      expect(text, code).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it('для русского UI сохраняет details', () => {
    document.documentElement.lang = 'ru';
    const text = translateBackendError(
      { code: 'LDAP_AUTH', message: 'Отказано в авторизации: data 52e', details: 'data 52e' },
      i18n.t.bind(i18n),
    );
    expect(text).toContain('data 52e');
  });
});
