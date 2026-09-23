import { useEffect, useRef, useState } from 'react';
import { Search, HelpCircle, X } from 'lucide-react';
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
 * Поле поиска с локальным буфером и внешней деbounce-логикой.
 *
 * Компонент остаётся управляемым: внешнее значение (например, сброс
 * при смене вкладки) синхронизируется обратно в локальный буфер.
 * Дебаунс выполняется потребителем (`useDebouncedValue`), поэтому
 * здесь — мгновенный отклик ввода без «резиновой» печати.
 *
 * Горячие клавиши: Ctrl/Cmd+K — фокус, Escape — очистка.
 */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Внешнее значение изменилось (сброс/программная установка) — синхронизируем буфер.
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
        className="w-[22px] h-[22px] absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
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
            className="text-muted-foreground hover:text-foreground transition-colors outline-none hover:bg-black/5 dark:hover:bg-white/10 rounded-full p-1 no-ring"
            aria-label={t('searchClear')}
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        )}
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="text-muted-foreground cursor-help hover:text-foreground transition-colors bg-transparent border-0 p-0 outline-none"
                aria-label={t('searchTooltip')}
                tabIndex={-1}
              >
                <HelpCircle
                  className="w-[22px] h-[22px] transition-transform duration-300 active:translate-y-[1px]"
                  aria-hidden
                />
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
