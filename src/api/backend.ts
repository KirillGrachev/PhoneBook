/**
 * Низкоуровневый мост к Rust-бэкенду.
 *
 * Единственное место, которое знает про `invoke` и форму ошибки Tauri.
 * Все ошибки нормализуются в {@link ApiError} со стабильным `code`,
 * чтобы UI локализовывал их без парсинга строк.
 */
import { invoke } from '@tauri-apps/api/core';

/** Признак запуска внутри webview Tauri (в браузере — демо-режим на моках). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Payload ошибки IPC от бэкенда: код для i18n и сообщение. */
export interface BackendErrorPayload {
  code?: string;
  message?: string;
  details?: string | null;
}

/** Типизированная ошибка бэкенда/окружения. */
export class ApiError extends Error {
  readonly code: string;
  readonly details: string | null;

  constructor(payload: BackendErrorPayload) {
    super(payload.message || payload.code || 'UNKNOWN_ERROR');
    this.name = 'ApiError';
    this.code = payload.code || 'INTERNAL';
    this.details = payload.details ?? null;
  }

  /** Нормализация произвольного отброса `invoke` (объект или JSON-строка). */
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
        // Не JSON — обычный текст ошибки.
      }
      return new ApiError({ code: 'INTERNAL', message: unknownError });
    }
    if (unknownError && typeof unknownError === 'object') {
      return new ApiError(unknownError as BackendErrorPayload);
    }
    return new ApiError({ code: 'INTERNAL', message: String(unknownError) });
  }
}

/** Типизированный вызов команды Rust с нормализацией ошибок. */
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
