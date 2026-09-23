import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import QRCode from '@/components/QRCodeComponent';

describe('QRCodeComponent (CJS-интероп)', () => {
  it('резолвится в валидный тип элемента (функция или forwardRef-объект)', () => {
    const asRecord = QRCode as unknown as Record<string, unknown>;
    const isValid = typeof QRCode === 'function' || typeof asRecord.render === 'function';
    expect(isValid).toBe(true);
  });

  it('рендерит SVG с данными vCard-подобной строки', () => {
    const html = renderToStaticMarkup(createElement(QRCode, { value: 'BEGIN:VCARD\nFN:Test\nEND:VCARD', size: 120 }));
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox');
  });
});
