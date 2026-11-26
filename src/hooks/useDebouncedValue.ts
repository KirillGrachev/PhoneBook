import { useEffect, useState } from 'react';

/**
 * Value debounce: returns `value` after `delayMs` of "quiet".
 * Used for the search box (a backend request on every key press
 * key — extra load on IPC and SQLite).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
