import { useEffect, useState } from 'react';

/**
 * Дебаунс значения: возвращает `value` спустя `delayMs` «затишья».
 * Используется для поисковой строки (запросы к бэкенду на каждое нажатие
 * клавиши — лишняя нагрузка на IPC и SQLite).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
