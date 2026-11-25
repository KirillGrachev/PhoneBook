import type { ComponentType, CSSProperties } from 'react';
import * as QRCodeNS from 'react-qr-code';

/** Public QR code props (a mirror of the react-qr-code types). */
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

/** The name of the React service tag (two dollar signs + "typeof") is assembled dynamically. */
const DOLLAR = String.fromCharCode(36);
const REACT_TYPE_TAG = DOLLAR + DOLLAR + 'typeof';

/**
 * A valid React element type: a function component/class OR a special object
 * (forwardRef/memo — an object with a React tag and a render function).
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
 * Unwraps the component through CJS/ESM interop.
 *
 * react-qr-code is published only as CJS (exports.default + exports.QRCode,
 * the component itself is a forwardRef object). Different bundlers (rolldown-vite in dev,
 * rollup in build, vitest) put either the component or the module object into default —
 * naive import broke lazy rendering ("Element type is invalid").
 * Here the resolution is explicit: we descend through .default/.QRCode to the first
 * of a valid element type.
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

/** A guaranteed valid component (after the check above). */
const QRCode: ComponentType<QRCodeProps> = resolved;

export default QRCode;
