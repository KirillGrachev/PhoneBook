import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/locales/en.json';
import ru from '@/locales/ru.json';

const resources = {
  ru: { translation: ru },
  en: { translation: en },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: {
    /** React экранирует значения самостоятельно. */
    escapeValue: false,
  },
});

export default i18n;
