import { describe, expect, it } from 'vitest';

import { personNameForLanguage, transliterateRussian } from '@/lib/transliteration';

describe('transliterateRussian', () => {
  it('переводит все буквы по таблице приложения 1', () => {
    expect(transliterateRussian('абвгдеёжзийклмнопрстуфхцчшщыэюя')).toBe('abvgdeiezhziyklmnoprstufhthchshschyeiuia');
    expect(transliterateRussian('АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЫЭЮЯ')).toBe('ABVGDEIEZHZIYKLMNOPRSTUFHTHCHSHSCHYEIUIA');
  });

  it('сохраняет регистр, пробелы и дефисы, отбрасывает ь/ъ', () => {
    expect(transliterateRussian('Грачев Кирилл Евгеньевич')).toBe('Grachev Kirill Evgenevich');
    expect(transliterateRussian('Пётр-Иванов')).toBe('Pietr-Ivanov');
    expect(transliterateRussian('Подъезд')).toBe('Podezd');
  });

  it('в английской локали возвращает транслит, в русской — оригинал', () => {
    expect(personNameForLanguage('Грачев Кирилл', 'en')).toBe('Grachev Kirill');
    expect(personNameForLanguage('Грачев Кирилл', 'ru')).toBe('Грачев Кирилл');
  });
});
