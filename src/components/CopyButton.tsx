import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface CopyButtonProps {
  text: string;
  className?: string;
  iconClassName?: string;
  variant?: 'light' | 'dark' | 'ghost';
}

const COPIED_RESET_MS = 2000;

/** Кнопка копирования с галочкой-подтверждением и корректной очисткой таймера. */
export function CopyButton({ text, className, iconClassName, variant = 'light' }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        if (resetTimer.current) {
          clearTimeout(resetTimer.current);
        }
        resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      } catch (error) {
        console.error('[copy] clipboard unavailable', error);
      }
    },
    [text],
  );

  const baseClasses =
    'w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0 outline-none relative overflow-hidden cursor-pointer';
  const iconBaseClasses = 'w-5 h-5 absolute transition-all duration-300';

  const variantClasses = {
    light: copied ? 'bg-white text-green-500 shadow-sm' : 'bg-white/10 hover:bg-white/20 active:bg-white/30 text-white',
    dark: copied
      ? 'bg-green-500 text-white shadow-sm'
      : 'bg-black/5 hover:bg-black/10 active:bg-black/15 dark:bg-white/10 dark:hover:bg-white/20 dark:active:bg-white/30 text-foreground',
    ghost: copied
      ? 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400'
      : 'hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/10 dark:active:bg-white/15 text-muted-foreground hover:text-foreground',
  }[variant];

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(baseClasses, variantClasses, className)}
      aria-label={t('action.copy')}
    >
      <Check
        aria-hidden
        className={cn(
          iconBaseClasses,
          iconClassName,
          copied ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 -rotate-45',
        )}
      />
      <Copy
        aria-hidden
        className={cn(
          iconBaseClasses,
          iconClassName,
          copied ? 'opacity-0 scale-50 rotate-45' : 'opacity-100 scale-100 rotate-0',
        )}
      />
    </button>
  );
}
