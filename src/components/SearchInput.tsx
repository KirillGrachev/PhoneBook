import { useEffect, useRef, useState } from 'react';
import { Search, HelpCircle, ClearInput } from '@/components/icons';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * A search field with a local buffer and external debounce logic.
 *
 * The component stays controlled: an external value (e.g. a reset
 * on tab change) is synchronized back into the local buffer.
 * Debouncing is done by the consumer (`useDebouncedValue`), so
 * here — instant input response without "rubbery" typing.
 *
 * Hotkeys: Ctrl/Cmd+K — focus, Escape — clear.
 */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The external value changed (reset/programmatic set) — synchronize the buffer.
  useEffect(() => {
    setLocalValue((current) => (current === value ? current : value));
  }, [value]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clear = () => {
    setLocalValue('');
    onChangeRef.current('');
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative flex-1 group', className)}>
      <Search
        className="w-[24px] h-[24px] absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        placeholder={placeholder}
        value={localValue}
        onChange={(event) => {
          setLocalValue(event.target.value);
          onChangeRef.current(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && localValue) {
            event.preventDefault();
            clear();
          }
        }}
        className={cn(
          'w-full h-[52px] bg-input hover:bg-input-hover border border-border rounded-[16px]',
          'pl-[52px] pr-[100px] text-[16px] outline-none transition-all text-foreground shadow-sm',
          'placeholder:text-muted-foreground placeholder:select-none',
        )}
        aria-label={placeholder || t('searchGlobal')}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pl-3 py-1.5 border-l border-foreground/15">
        {localValue && (
          <button
            type="button"
            onClick={clear}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors outline-none hover:bg-black/5 dark:hover:bg-white/10 no-ring"
            aria-label={t('searchClear')}
          >
            <ClearInput className="w-5 h-5" aria-hidden />
          </button>
        )}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center text-muted-foreground cursor-help hover:text-foreground transition-colors bg-transparent border-0 p-0 outline-none"
                aria-label={t('searchTooltip')}
                tabIndex={-1}
              >
                <HelpCircle className="w-[24px] h-[24px] transition-transform duration-300" aria-hidden />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={5}
                className="z-50 max-w-[280px] bg-slate-800 text-white shadow-xl text-[14px] font-medium rounded-[8px] py-2 px-3 leading-snug"
              >
                {t('searchTooltip')}
                <Tooltip.Arrow className="fill-slate-800" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
    </div>
  );
}
