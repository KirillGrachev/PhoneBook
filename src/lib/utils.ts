import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Композиция clsx + tailwind-merge (устранение конфликтующих классов). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** «5 минут назад» / «вчера, 14:32» — компактный человекочитаемый формат. */
export function formatRelativeTime(unixSeconds: number | null | undefined, locale: string): string {
  if (!unixSeconds) {
    return '';
  }
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return locale === 'en' ? 'just now' : 'только что';
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) {
    return formatter.format(-minutes, 'minute');
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return formatter.format(-hours, 'hour');
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return formatter.format(-days, 'day');
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
