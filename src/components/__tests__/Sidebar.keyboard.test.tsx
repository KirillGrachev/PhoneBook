import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '../Sidebar';
import type { Contact } from '@/types';

// The virtualizer needs real layout measurements; for keyboard behavior we only
// need the global keydown listener, so the list geometry is stubbed out.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
  }),
}));

const contacts: Contact[] = [
  { id: 'c1', fullName: 'First Contact' },
  { id: 'c2', fullName: 'Second Contact' },
  { id: 'c3', fullName: 'Third Contact' },
];

function pressArrow(key: 'ArrowDown' | 'ArrowUp', repeat: boolean) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
}

function renderSidebar(onSelect: (id: string | null) => void) {
  return render(
    <Sidebar
      contacts={contacts}
      selectedId="c1"
      onSelect={onSelect}
      selectedOrg={null}
      activeTab="global"
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      limitReached={false}
      total={contacts.length}
    />,
  );
}

describe('Sidebar keyboard navigation', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('moves immediately on the first press and throttles held repeats', () => {
    const onSelect = vi.fn();
    renderSidebar(onSelect);

    pressArrow('ArrowDown', false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith('c2');

    // OS auto-repeat arrives before the delay has elapsed: it must not move.
    vi.spyOn(performance, 'now').mockReturnValue(1050);
    pressArrow('ArrowDown', true);
    expect(onSelect).toHaveBeenCalledTimes(1);

    // Once the interval has passed, the next repeat is accepted.
    vi.spyOn(performance, 'now').mockReturnValue(1120);
    pressArrow('ArrowDown', true);
    expect(onSelect).toHaveBeenCalledTimes(2);

    // A fresh physical press is never throttled.
    vi.spyOn(performance, 'now').mockReturnValue(1130);
    pressArrow('ArrowDown', false);
    expect(onSelect).toHaveBeenCalledTimes(3);
  });

  it('throttles ArrowUp repeats as well', () => {
    const onSelect = vi.fn();
    renderSidebar(onSelect);

    pressArrow('ArrowUp', false);
    expect(onSelect).toHaveBeenCalledTimes(1);

    vi.spyOn(performance, 'now').mockReturnValue(1010);
    pressArrow('ArrowUp', true);
    expect(onSelect).toHaveBeenCalledTimes(1);

    vi.spyOn(performance, 'now').mockReturnValue(1120);
    pressArrow('ArrowUp', true);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
