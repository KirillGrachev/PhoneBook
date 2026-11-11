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
  const params = { details: apiError.details ?? apiError.message, defaultValue: '' };
  // Английские тексты не подставляют русский `details` бэкенда: техническая
  // часть остаётся в ApiError/логах, пользователь видит нейтральную фразу.
  const language = typeof document !== 'undefined' ? document.documentElement.lang : 'ru';
  if (language.startsWith('en')) {
    const english = t(`errors.${apiError.code}_en`, params);
    if (english) {
      return english;
    }
  }
  const translated = t(`errors.${apiError.code}`, params);
  return translated || apiError.message;
}
