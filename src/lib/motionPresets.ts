import type { Variants } from 'motion/react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Shared presets for content appearing after loading.
 *
 * A single motion family for all directory surfaces: colleague lists
 * (the department / job title / office modal), the main result list and
 * settings sections switch with the same crossfade, and non-empty lists
 * are additionally revealed generation by generation. Durations and easing are gathered here,
 * so that "smooth" means the same motion everywhere; the CSS timings of Radix
 * dropdowns (`.submenu-pop` in index.css) mirror these same values.
 *
 * The "Animations" switch disables presets through
 * [`useMotionPresets`]: disabled presets have duration/delay/stagger
 * zeroed because the variant's own `transition` overrides
 * `MotionConfig`. The `.disable-animations` class additionally zeroes
 * CSS animations of dropdowns.
 */

/** Crossfade of the content block: loading → list → empty state. */
export const contentRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

/**
 * The list container: a whole crossfade plus a row cascade.
 *
 * `staggerChildren` only affects mounting of rows (first load,
 * page or mode change): rows pre-mounted by the search filter
 * over the already shown list, simply take their places without a cascade.
 */
export const listRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: 'easeOut', delayChildren: 0.04, staggerChildren: 0.035 },
  },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

/** A list row: a light rise with a fade-in, no horizontal jerk. */
export const listRowRevealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

const instantContentRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const instantListRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0, delayChildren: 0, staggerChildren: 0 },
  },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const instantListRowRevealVariants: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const enabledPresets = {
  content: contentRevealVariants,
  list: listRevealVariants,
  row: listRowRevealVariants,
};

const disabledPresets = {
  content: instantContentRevealVariants,
  list: instantListRevealVariants,
  row: instantListRowRevealVariants,
};

/**
 * Presets that respect the global animation toggle. Returns stable
 * objects, so as not to recreate variants on every render.
 */
export function useMotionPresets() {
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);
  return animationsEnabled ? enabledPresets : disabledPresets;
}
