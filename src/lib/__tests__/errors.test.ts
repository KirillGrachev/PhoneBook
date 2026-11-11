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

  it('для русского UI сохраняет details', () => {
    document.documentElement.lang = 'ru';
    const text = translateBackendError(
      { code: 'LDAP_AUTH', message: 'Отказано в авторизации: data 52e', details: 'data 52e' },
      i18n.t.bind(i18n),
    );
    expect(text).toContain('data 52e');
  });
});
