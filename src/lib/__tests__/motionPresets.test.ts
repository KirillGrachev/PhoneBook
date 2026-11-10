import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useMotionPresets } from '@/lib/motionPresets';
import { useAppStore } from '@/store/useAppStore';

afterEach(() => {
  useAppStore.setState({ animationsEnabled: true });
});

describe('useMotionPresets: тумблер анимаций', () => {
  it('обнуляет duration/delay/stagger у всех пресетов', () => {
    useAppStore.setState({ animationsEnabled: false });
    const { result } = renderHook(() => useMotionPresets());
    type Transition = {
      duration?: number;
      delayChildren?: number;
      staggerChildren?: number;
    };
    const content = result.current.content as Record<string, { transition?: Transition }>;
    const list = result.current.list as Record<string, { transition?: Transition }>;
    const row = result.current.row as Record<string, { transition?: Transition }>;

    expect(content.visible.transition?.duration).toBe(0);
    expect(content.exit.transition?.duration).toBe(0);
    expect(list.visible.transition?.duration).toBe(0);
    expect(list.visible.transition?.delayChildren).toBe(0);
    expect(list.visible.transition?.staggerChildren).toBe(0);
    expect(row.visible.transition?.duration).toBe(0);
  });

  it('возвращает обычные пресеты при включённых анимациях', () => {
    useAppStore.setState({ animationsEnabled: true });
    const { result } = renderHook(() => useMotionPresets());
    const content = result.current.content as Record<string, { transition?: { duration?: number } }>;
    expect(content.visible.transition?.duration).toBe(0.2);
  });
});
