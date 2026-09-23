import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { BookmarkMinus, DatabaseZap, RefreshCw, SearchX } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Contact, TabType } from '@/types';

interface SidebarProps {
  contacts: Contact[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedOrg: string | null;
  activeTab: TabType;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Показано не всё: total больше размера страницы. */
  limitReached: boolean;
  /** Точное общее число совпадений. */
  total: number;
  /** Кастомное действие для пустого состояния (настройка AD / демо-режим). */
  emptyAction?: ReactNode;
  /** Переопределение текстов пустого состояния. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Показывать кнопку быстрого удаления из избранного (вкладка «Мои контакты»). */
  showUnsave?: boolean;
  onUnsave?: (id: string) => void;
}

const ITEM_HEIGHT = 64;

/** Виртуализированный список результатов (тысячи записей без тормозов). */
export function Sidebar({
  contacts,
  selectedId,
  onSelect,
  selectedOrg,
  activeTab,
  isLoading,
  isError,
  onRetry,
  limitReached,
  total,
  emptyAction,
  emptyTitle,
  emptyDescription,
  showUnsave = false,
  onUnsave,
}: SidebarProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: contacts.length,
    getScrollElement: () => parentRef.current,
    getItemKey: (index) => contacts[index].id,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 10,
    paddingStart: 12,
    paddingEnd: 12,
  });

  const moveSelection = useCallback(
    (delta: number) => {
      if (contacts.length === 0) {
        return;
      }
      const currentIndex = contacts.findIndex((contact) => contact.id === selectedId);
      const nextIndex =
        currentIndex === -1
          ? delta > 0
            ? 0
            : contacts.length - 1
          : (currentIndex + delta + contacts.length) % contacts.length;
      onSelect(contacts[nextIndex].id);
      virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    },
    [contacts, selectedId, onSelect, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Home':
          event.preventDefault();
          onSelect(contacts[0]?.id ?? null);
          virtualizer.scrollToIndex(0, { align: 'auto' });
          break;
        case 'End':
          event.preventDefault();
          onSelect(contacts[contacts.length - 1]?.id ?? null);
          virtualizer.scrollToIndex(Math.max(contacts.length - 1, 0), { align: 'auto' });
          break;
        default:
          break;
      }
    },
    [contacts, moveSelection, onSelect, virtualizer],
  );

  return (
    <div className="w-full shrink-0 bg-background border-r border-border flex flex-col z-10 transition-colors duration-300 ease-in-out h-full overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-surface/50 backdrop-blur-md z-20 shrink-0 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-muted-foreground">
          {t('searchResults')} {total > 0 && `(${total})`}
        </h2>
        {isLoading && (
          <div
            className="w-3.5 h-3.5 border-2 border-primary/25 border-t-primary rounded-full animate-spin"
            aria-hidden
          />
        )}
      </div>

      <div
        ref={parentRef}
        className="flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="listbox"
        aria-label={t('searchResults')}
        aria-busy={isLoading}
        aria-activedescendant={selectedId ? `contact-${selectedId}` : undefined}
      >
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center mt-6">
            <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20">
              <SearchX className="w-6 h-6" aria-hidden />
            </div>
            <p className="text-sm font-semibold text-foreground">{t('errorLoadContacts')}</p>
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" aria-hidden />
              {t('retry')}
            </button>
          </div>
        ) : isLoading && contacts.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground mt-10" role="status">
            {t('loading')}
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center mt-6">
            <div className="w-14 h-14 rounded-full bg-surface-hover text-muted-foreground flex items-center justify-center border border-border">
              <DatabaseZap className="w-6 h-6" aria-hidden />
            </div>
            <p className="text-sm font-semibold text-foreground">{emptyTitle ?? t('emptyState.title')}</p>
            <p className="text-[13px] text-muted-foreground max-w-[260px] leading-relaxed">
              {emptyDescription ?? t('emptyState.desc')}
            </p>
            {emptyAction}
          </div>
        ) : (
          <>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const contact = contacts[virtualItem.index];
                const isSelected = selectedId === contact.id;

                return (
                  <div
                    id={`contact-${contact.id}`}
                    key={virtualItem.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    className="px-3 py-1"
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div
                      onClick={() => onSelect(contact.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(contact.id);
                        }
                      }}
                      role="button"
                      tabIndex={-1}
                      className={cn(
                        'px-3 h-full flex flex-col justify-center rounded-[10px] gap-1 cursor-pointer transition-colors outline-none relative group',
                        isSelected ? 'bg-primary text-white shadow-sm' : 'hover:bg-input text-foreground',
                      )}
                    >
                      <div className="font-semibold text-[15px] truncate leading-tight pr-7">{contact.fullName}</div>
                      <div
                        className={cn(
                          'text-[13px] truncate font-normal pr-7',
                          isSelected ? 'text-blue-100' : 'text-muted-foreground',
                        )}
                      >
                        {!selectedOrg && activeTab !== 'kmaruda' && contact.organization && (
                          <span className="mr-1">{contact.organization} •</span>
                        )}
                        <span>{contact.jobTitle || contact.department || t('employee')}</span>
                      </div>
                      {showUnsave && onUnsave && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onUnsave(contact.id);
                          }}
                          aria-label={t('removeFromSaved')}
                          title={t('removeFromSaved')}
                          className={cn(
                            'absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center',
                            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer outline-none',
                            isSelected
                              ? 'text-white hover:bg-white/20'
                              : 'text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10',
                          )}
                        >
                          <BookmarkMinus className="w-4 h-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {limitReached && (
              <div className="px-6 py-3 text-center text-[12px] text-muted-foreground">
                {t('limitReached', { shown: contacts.length, total })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
