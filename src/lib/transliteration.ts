/**
 * Транслитерация по приложению 1 (русский → латинский).
 *
 * Таблица задаёт только заглавные буквы; строчные получают тот же результат
 * в нижнем регистре. Мягкий и твёрдый знаки не имеют латинского аналога.
 */
const UPPER: Record<string, string> = {
  А: 'A',
  Б: 'B',
  В: 'V',
  Г: 'G',
  Д: 'D',
  Е: 'E',
  Ё: 'IE',
  Ж: 'ZH',
  З: 'Z',
  И: 'I',
  Й: 'Y',
  К: 'K',
  Л: 'L',
  М: 'M',
  Н: 'N',
  О: 'O',
  П: 'P',
  Р: 'R',
  С: 'S',
  Т: 'T',
  У: 'U',
  Ф: 'F',
  Х: 'H',
  Ц: 'TH',
  Ч: 'CH',
  Ш: 'SH',
  Щ: 'SCH',
  Ы: 'Y',
  Э: 'E',
  Ю: 'IU',
  Я: 'IA',
  Ъ: '',
  Ь: '',
};

export function transliterateRussian(value: string): string {
  return Array.from(value)
    .map((char) => {
      const upper = UPPER[char];
      if (upper !== undefined) {
        return upper;
      }
      const lower = UPPER[char.toUpperCase()];
      return lower === undefined ? char : lower.toLowerCase();
    })
    .join('');
}

/** Имя для показа/экспорта: в английской локали — транслитерация. */
export function personNameForLanguage(fullName: string, language = 'en'): string {
  return language.toLowerCase().startsWith('en') ? transliterateRussian(fullName) : fullName;
}
