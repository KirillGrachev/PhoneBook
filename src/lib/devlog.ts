import { invokeCommand, isTauri } from '@/api/backend';

/**
 * Dev logging of user actions and key application steps.
 *
 * Writes to the webview console only in the dev build (`import.meta.env.DEV`),
 * and in the desktop it additionally duplicates the record to the terminal where
 * `npm run tauri dev`: the Rust command `dev_log` prints it through tracing
 * into the process stdout. The condition is constant, so in the prod build Vite
 * removes the calls together with their arguments (dead code elimination).
 * The single entry point for `console.log` in the app — the lint rule
 * no-console is disabled selectively.
 */
/** Writing a frontend error to the Rust file log (no console in release). */
export function logFrontend(level: 'error' | 'warn' | 'info' | 'debug', scope: string, message: string): void {
  if (!isTauri()) {
    return;
  }
  void invokeCommand<void>('frontend_log', { level, scope, message }).catch(() => {});
}

export function devLog(scope: string, ...args: unknown[]): void {
  const message = args.map(argToText).join(' ');
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console -- centralized dev log
    console.log(`[phonebook:${scope}]`, ...args);
  }

  if (isTauri()) {
    // Fire-and-forget: actions are written to the file log even in the release build.
    invokeCommand<void>('frontend_log', { level: 'info', scope, message }).catch(() => {});
  }
}

/** Serialization of an arbitrary `devLog` argument into terminal text. */
function argToText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // Circular references and other non-serializable values - plain String().
    return String(value);
  }
}
