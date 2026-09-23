import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { cn } from '@/lib/utils';

/** Опция универсального селекта. */
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
}

/**
 * Стилизованный выпадающий список в общем дизайне приложения
 * (вместо нативного <select>, чей системный dropdown выбивается из стиля).
 */
export function Select<T>({ value, options, onChange, ariaLabel, className }: SelectProps<T>) {
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
            'flex items-center gap-2 h-[34px] px-3 rounded-[10px] border border-border bg-input',
            'text-[13px] font-semibold text-foreground outline-none cursor-pointer',
            'hover:bg-input-hover transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <span className="truncate">{current?.label ?? '—'}</span>
          <ChevronDown
            className={cn('w-4 h-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
          className="bg-surface rounded-[12px] border border-border shadow-[0_4px_20px_rgba(0,0,0,0.25)] py-1.5 z-50"
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
                <span className="truncate">{option.label}</span>
                {option.value === value && <Check className="w-4 h-4 shrink-0" aria-hidden />}
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
