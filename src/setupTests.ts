import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia — a minimal stub for the theme hooks.
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

/** IntersectionObserver is used by lazy avatar loading. */
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

// navigator.clipboard is absent in jsdom.
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  // user-event re-attaches its own clipboard stub — we allow redefinition.
  configurable: true,
  value: { writeText: async () => {} },
});

/** ResizeObserver is used by Radix poppers (dropdowns, tooltips). */
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverStub,
});
