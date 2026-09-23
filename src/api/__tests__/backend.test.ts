import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/backend';

describe('ApiError.from — нормализация ошибок IPC', () => {
  it('разбирает объект-пейлоад из Rust', () => {
    const error = ApiError.from({ code: 'LDAP_AUTH', message: 'неверный пароль', details: 'data 52e' });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('LDAP_AUTH');
    expect(error.message).toBe('неверный пароль');
    expect(error.details).toBe('data 52e');
  });

  it('разбирает JSON-строку (типичный отброс invoke)', () => {
    const error = ApiError.from('{"code":"LDAP_TIMEOUT","message":"таймаут"}');
    expect(error.code).toBe('LDAP_TIMEOUT');
    expect(error.message).toBe('таймаут');
  });

  it('обычная строка становится INTERNAL с исходным текстом', () => {
    const error = ApiError.from('command not found: search_contacts');
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('command not found: search_contacts');
  });

  it('JS-исключение нормализуется без потери текста', () => {
    const error = ApiError.from(new TypeError('boom'));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('boom');
  });

  it('ApiError проходит через from без изменений', () => {
    const original = new ApiError({ code: 'DB_ERROR', message: 'x' });
    expect(ApiError.from(original)).toBe(original);
  });

  it('payload без кода получает INTERNAL', () => {
    const error = ApiError.from({ message: 'что-то сломалось' });
    expect(error.code).toBe('INTERNAL');
  });
});
