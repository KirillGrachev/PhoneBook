import type { TFunction } from 'i18next';

import { ApiError } from '@/api/backend';

/**
 * Translating a backend error into a user-facing string.
 *
 * The error code (`LDAP_AUTH`, `DB_ERROR`, ...) is used as an i18n key
 * `errors.<CODE>`; if there is no key, the backend message is shown as is.
 */
export function translateBackendError(error: unknown, t: TFunction): string {
  const apiError = ApiError.from(error);
  const params = { details: apiError.details ?? apiError.message, defaultValue: '' };
  // English texts do not substitute the Russian `details` of the backend: technical
  // part remains in ApiError/logs; the user sees a neutral phrase.
  const language = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
  if (language.startsWith('en')) {
    const english = t(`errors.${apiError.code}_en`, params);
    if (english) {
      return english;
    }
  }
  const translated = t(`errors.${apiError.code}`, params);
  return translated || apiError.message;
}
