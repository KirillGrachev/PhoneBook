import { invokeCommand, isTauri } from '@/api/backend';

/**
 * Dev-логирование действий пользователя и ключевых шагов приложения.
 *
 * Пишет в консоль webview только в dev-сборке (`import.meta.env.DEV`),
 * а в десктопе дополнительно дублирует запись в терминал, где запущен
 * `npm run tauri dev`: Rust-команда `dev_log` печатает её через tracing
 * в stdout процесса. Условие константное, поэтому в prod-сборке Vite
 * вырезает вызовы вместе с аргументами (dead code elimination).
 * Единственная точка входа для `console.log` в приложении — lint-правило
 * no-console отключено точечно.
 */
export function devLog(scope: string, ...args: unknown[]): void {
  if (!import.meta.env.DEV) {
    return;
  }
  // eslint-disable-next-line no-console -- централизованный dev-лог, в prod вырезается сборкой
  console.log(`[phonebook:${scope}]`, ...args);

  if (isTauri()) {
    // Fire-and-forget: логирование не должно ломать UI, ошибки IPC глотаются.
    invokeCommand<void>('dev_log', { scope, message: args.map(argToText).join(' ') }).catch(() => {});
  }
}

/** Сериализация произвольного аргумента `devLog` в текст для терминала. */
function argToText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Циклические ссылки и прочее несериализуемое — обычный String().
    return String(value);
  }
}
