import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

interface IconButtonProps extends ComponentProps<'button'> {
  icon: LucideIcon;
  className?: string;
}

/** Круглая иконочная кнопка с единым стилем нажатия/ховера. */
export function IconButton({ icon: Icon, className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'h-11 w-11 flex items-center justify-center rounded-full text-muted-foreground',
        'hover:text-foreground hover:bg-surface-hover border border-transparent transition-all duration-300',
        // Без «прыжка» при нажатии: в модальных окнах (QR, отдел) смещение
        // крестика выглядит как дефект, а не как отклик.
        'outline-none shrink-0 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      <Icon className="w-6 h-6 pointer-events-none" aria-hidden />
    </button>
  );
}
