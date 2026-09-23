import type { ComponentType, CSSProperties } from 'react';
import * as QRCodeNS from 'react-qr-code';

/** Публичные пропсы QR-кода (зеркало типов react-qr-code). */
export interface QRCodeProps {
  value: string;
  size?: number;
  bgColor?: string;
  fgColor?: string;
  level?: 'L' | 'M' | 'Q' | 'H';
  title?: string;
  style?: CSSProperties;
}

interface MaybeModule {
  default?: unknown;
  QRCode?: unknown;
}

/** Имя служебного тега React (знак доллара дважды + «typeof») собираем динамически. */
const DOLLAR = String.fromCharCode(36);
const REACT_TYPE_TAG = DOLLAR + DOLLAR + 'typeof';

/**
 * Валидный тип элемента React: функция-компонент/класс ИЛИ спец-объект
 * (forwardRef/memo — объект с тегом React и функцией render).
 */
function isComponentType(value: unknown): value is ComponentType<QRCodeProps> {
  if (typeof value === 'function') {
    return true;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return typeof record[REACT_TYPE_TAG] === 'symbol' && typeof record.render === 'function';
  }
  return false;
}

/**
 * Разворачивает компонент сквозь CJS/ESM-интероп.
 *
 * react-qr-code публикуется только в CJS (exports.default + exports.QRCode,
 * сам компонент — forwardRef-объект). Разные бандлеры (rolldown-vite в dev,
 * rollup в build, vitest) отдают в default то компонент, то объект модуля —
 * наивный импорт ломал lazy-рендер («Element type is invalid»).
 * Здесь разрешение явное: спускаемся по .default/.QRCode до первого
 * валидного типа элемента.
 */
function unwrapComponent(module: unknown): ComponentType<QRCodeProps> | undefined {
  let current: unknown = module;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isComponentType(current)) {
      return current;
    }
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    const record = current as MaybeModule;
    if (isComponentType(record.QRCode)) {
      return record.QRCode;
    }
    current = record.default;
  }
  return undefined;
}

const resolved = unwrapComponent(QRCodeNS);

if (!resolved) {
  throw new Error('react-qr-code: не удалось разрешить компонент (несовместимый интероп модуля)');
}

/** Гарантированно валидный компонент (после проверки выше). */
const QRCode: ComponentType<QRCodeProps> = resolved;

export default QRCode;
