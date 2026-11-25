import type { ComponentProps } from 'react';
import type { IconComponent } from '@/components/icons';

import { cn } from '@/lib/utils';

interface IconButtonProps extends ComponentProps<'button'> {
  icon: IconComponent;
  className?: string;
  iconClassName?: string;
}

/** A round icon button with a unified press/hover style. */
export function IconButton({ icon: Icon, className, iconClassName, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'h-11 w-11 flex items-center justify-center rounded-full text-muted-foreground',
        'hover:text-foreground hover:bg-surface-hover border border-transparent transition-all duration-300',
        // Without a "jump" on press: in modals (QR, department) the offset
        // the close cross looks like a defect rather than a response.
        'outline-none shrink-0 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <Icon className={cn('pointer-events-none', iconClassName ?? 'w-6 h-6')} aria-hidden />
    </button>
  );
}
