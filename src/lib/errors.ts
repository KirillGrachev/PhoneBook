import type { TFunction } from 'i18next';

import { ApiError } from '@/api/backend';

/**
 * Перевод ошибки бэкенда в строку для пользователя.
 *
 * Код ошибки (`LDAP_AUTH`, `DB_ERROR`, ...) используется как i18n-ключ
 * `errors.<CODE>`; если ключа нет — показывается сообщение бэкенда как есть.
 */
export function translateBackendError(error: unknown, t: TFunction): string {
  const apiError = ApiError.from(error);
  const key = `errors.${apiError.code}`;
  const translated = t(key, {
    details: apiError.details ?? apiError.message,
    defaultValue: '',
  });
  return translated || apiError.message;
}
