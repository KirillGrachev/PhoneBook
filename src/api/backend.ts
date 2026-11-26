/**
 * A low-level bridge to the Rust backend.
 *
 * The only place that knows about `invoke` and the shape of a Tauri error.
 * All errors are normalized into {@link ApiError} with a stable `code`,
 * so the UI localizes them without parsing strings.
 */
import { invoke } from '@tauri-apps/api/core';

/** The flag of running inside a Tauri webview (in the browser — demo mode on mocks). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** IPC error payload from the backend: a code for i18n and a message. */
export interface BackendErrorPayload {
  code?: string;
  message?: string;
  details?: string | null;
}

/** A typed backend/environment error. */
export class ApiError extends Error {
  readonly code: string;
  readonly details: string | null;

  constructor(payload: BackendErrorPayload) {
    super(payload.message || payload.code || 'UNKNOWN_ERROR');
    this.name = 'ApiError';
    this.code = payload.code || 'INTERNAL';
    this.details = payload.details ?? null;
  }

  /** Normalization of an arbitrary `invoke` rejection (an object or a JSON string). */
  static from(unknownError: unknown): ApiError {
    if (unknownError instanceof ApiError) {
      return unknownError;
    }
    if (typeof unknownError === 'string') {
      try {
        const parsed = JSON.parse(unknownError) as BackendErrorPayload;
        if (parsed && typeof parsed === 'object') {
          return new ApiError(parsed);
        }
      } catch {
        // Not JSON — a plain error text.
      }
      return new ApiError({ code: 'INTERNAL', message: unknownError });
    }
    if (unknownError && typeof unknownError === 'object') {
      return new ApiError(unknownError as BackendErrorPayload);
    }
    return new ApiError({ code: 'INTERNAL', message: String(unknownError) });
  }
}

/** A typed Rust command call with error normalization. */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new ApiError({
      code: 'NOT_RUNNING_IN_DESKTOP',
      message: 'Команда доступна только в десктоп-окружении Tauri',
    });
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw ApiError.from(error);
  }
}
