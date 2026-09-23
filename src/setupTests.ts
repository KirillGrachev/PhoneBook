import '@testing-library/jest-dom/vitest';

// jsdom не реализует matchMedia — минимальная заглушка для хуков темы.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

/** IntersectionObserver используется ленивой загрузкой аватаров. */
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverStub,
});

// navigator.clipboard отсутствует в jsdom.
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  // user-event повторно навешивает свой стаб clipboard — разрешаем переопределение.
  configurable: true,
  value: { writeText: async () => {} },
});

/** ResizeObserver используется Radix-попперами (дропдауны, тултипы). */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});
