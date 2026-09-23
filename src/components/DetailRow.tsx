import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';

interface DetailRowProps {
  icon: LucideIcon;
  label: string;
  value?: string;
  isLink?: boolean;
  onClick?: () => void;
  showArrow?: boolean;
  copyable?: boolean;
}

/** Строка карточки контакта: иконка, подпись, значение, копирование, стрелка. */
export function DetailRow({
  icon: Icon,
  label,
  value,
  isLink = false,
  onClick,
  showArrow = false,
  copyable = false,
}: DetailRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-5 py-3 transition-colors group',
        onClick ? 'cursor-pointer hover:bg-surface-hover active:bg-surface-active' : 'hover:bg-surface-hover',
      )}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center shrink-0 transition-colors bg-primary/10 text-primary">
        <Icon className="w-[18px] h-[18px]" aria-hidden />
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="text-[12px] font-semibold text-muted-foreground mb-0.5 transition-colors">{label}</div>
        <div
          title={value}
          className={cn(
            // Без truncate: на узких окнах длинные почты и должности
            // переносятся на следующую строку, а не прячутся под «…».
            'text-[15px] break-words border-b border-transparent min-h-[21px] transition-colors select-text',
            !value ? 'text-muted-foreground italic' : isLink ? 'text-primary' : 'text-foreground font-medium',
          )}
        >
          {value || t('empty')}
        </div>
      </div>
      {copyable && value && (
        <CopyButton
          text={value}
          variant="ghost"
          className="w-8 h-8 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          iconClassName="w-4 h-4"
        />
      )}
      {showArrow && value && (
        <ChevronRight
          className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0"
          aria-hidden
        />
      )}
    </div>
  );
}
