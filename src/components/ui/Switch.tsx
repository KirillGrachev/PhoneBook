import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** Акцентный цвет во включённом состоянии (по умолчанию — primary). */
  activeClassName?: string;
  className?: string;
}

/**
 * Доступный тумблер (role="switch") — единый компонент вместо пяти
 * копий разметки, как было в исходной версии.
 */
export function Switch({ checked, onChange, disabled, ariaLabel, activeClassName, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-300',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        checked ? cn('border-primary', activeClassName ?? 'bg-primary') : 'bg-input hover:bg-input-hover border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] transform rounded-full bg-white transition-transform duration-300 shadow',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}
