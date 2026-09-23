import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface TextFieldProps extends Omit<ComponentProps<'input'>, 'className'> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Дополнительные классы самого input (например, font-mono). */
  className?: string;
  containerClassName?: string;
}

/** Подписанное текстовое поле настроек с единым стилем и подсказкой. */
export function TextField({ label, hint, error, className, containerClassName, id, ...inputProps }: TextFieldProps) {
  const fieldId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label htmlFor={fieldId} className="text-[12px] font-bold text-muted-foreground uppercase ml-1">
        {label}
      </label>
      <input
        id={fieldId}
        className={cn(
          'w-full bg-input border rounded-[10px] px-3 py-2 text-[14px] text-foreground outline-none transition-colors',
          'placeholder:text-muted-foreground disabled:opacity-50',
          error ? 'border-red-500/60 focus:border-red-500' : 'border-border focus:border-primary',
          className,
        )}
        aria-invalid={Boolean(error)}
        {...inputProps}
      />
      {error ? (
        <span className="text-[12px] text-red-500 font-medium ml-1">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-muted-foreground ml-1 leading-snug">{hint}</span>
      ) : null}
    </div>
  );
}
