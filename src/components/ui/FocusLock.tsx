import { cloneElement, useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { createFocusTrap } from 'focus-trap';

interface FocusLockProps {
  children: ReactNode;
  /** Temporarily disable the trap without unmounting the children. */
  disabled?: boolean;
  /** Move focus into the trap on activation. Defaults to true. */
  autoFocus?: boolean;
  /** Return focus to the previously focused element on deactivation. Defaults to true. */
  returnFocus?: boolean | { preventScroll?: boolean };
  /** Kept for API compatibility; the trap always focuses with preventScroll. */
  focusOptions?: { preventScroll?: boolean };
}

/**
 * A scroll-safe focus trap.
 *
 * Wraps `focus-trap` with `preventScroll` enabled for every programmatic focus
 * (activation, tab cycling, focus recovery, and return focus). This prevents the
 * settings page from jumping to the top when a clicked button becomes disabled
 * or unmounts while a dialog opens.
 */
export default function FocusLock({
  children,
  disabled = false,
  autoFocus = true,
  returnFocus = true,
}: FocusLockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoFocusRef = useRef(autoFocus);
  const returnFocusRef = useRef(returnFocus);
  autoFocusRef.current = autoFocus;
  returnFocusRef.current = returnFocus;

  useEffect(() => {
    const node = containerRef.current;
    if (!node || disabled) {
      return;
    }

    const trap = createFocusTrap(node, {
      preventScroll: true,
      // The app handles Escape itself (SettingsPage closes, modals own their UX).
      escapeDeactivates: false,
      // Do not swallow clicks outside the trap (title bar, backdrop handlers).
      allowOutsideClick: true,
      clickOutsideDeactivates: false,
      delayInitialFocus: false,
      delayReturnFocus: false,
      returnFocusOnDeactivate: true,
      fallbackFocus: node,
      initialFocus: () => {
        if (!autoFocusRef.current) {
          return false;
        }
        const marked = node.querySelector<HTMLElement>('[data-autofocus]');
        // Undefined lets focus-trap pick the first tabbable node.
        return marked ?? undefined;
      },
    });

    trap.activate();
    return () => {
      trap.deactivate({ returnFocus: Boolean(returnFocusRef.current) });
    };
  }, [disabled]);

  return (
    <div ref={containerRef} tabIndex={-1} data-focus-lock>
      {children}
    </div>
  );
}

/**
 * Marks the element that should receive initial focus inside a {@link FocusLock}.
 * The marked node is found via `[data-autofocus]` when the trap activates.
 */
export function AutoFocusInside({ children }: { children: ReactElement }) {
  return cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-autofocus': true });
}
