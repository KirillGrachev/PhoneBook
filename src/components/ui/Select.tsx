import { useState } from 'react';
import { Check, ChevronDown } from '@/components/icons';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { cn } from '@/lib/utils';

/** An option of the universal select. */
export interface SelectOption<T> {
  value: T;
  label: string;
}

interface SelectProps<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /** The side from which the list opens. By default Radix chooses itself. */
  side?: 'top' | 'bottom';
  /** Do not flip the list if there is little space below. */
  avoidCollisions?: boolean;
  /** Indent from the window edge so the list does not stick/get clipped. */
  collisionPadding?: number;
}

/**
 * A styled dropdown in the shared app design
 * (instead of a native <select>, whose system dropdown breaks the style).
 */
export function Select<T>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  side,
  avoidCollisions,
  collisionPadding = 8,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          className={cn(
            'inline-flex h-[34px] items-center justify-between gap-2 px-3 py-0 leading-none rounded-[10px] border border-border bg-input',
            'text-[13px] font-semibold text-foreground outline-none cursor-pointer',
            'hover:bg-input-hover transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className="truncate leading-none">{current?.label ?? '—'}</span>
          <ChevronDown
            className={cn(
              'w-4 h-4 shrink-0 self-center text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          side={side}
          sideOffset={6}
          avoidCollisions={avoidCollisions}
          collisionPadding={collisionPadding}
          style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
          className="submenu-pop bg-surface rounded-[12px] border border-border shadow-[0_4px_20px_rgba(0,0,0,0.25)] py-1.5 z-50"
        >
          {options.map((option) => (
            <DropdownMenu.Item asChild key={String(option.value)}>
              <button
                type="button"
                onClick={() => onChange(option.value)}
                className={cn(
                  'w-full flex items-center justify-between gap-3 px-3.5 py-2 text-[13px] outline-none cursor-pointer text-left',
                  'focus:bg-surface-hover transition-colors',
                  option.value === value ? 'text-primary font-semibold bg-primary/10' : 'text-foreground',
                )}
              >
                <span className="truncate leading-none">{option.label}</span>
                {option.value === value && <Check className="w-4 h-4 shrink-0" aria-hidden />}
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
