import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, Building2, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import FocusLock, { AutoFocusInside } from 'react-focus-lock';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/utils';
import { getContactsService } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';

interface DepartmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  department: string | null;
  organization: string | null;
  onSelectContact: (id: string) => void;
}

const PAGE_SIZE = 10;
const DEPARTMENT_LIMIT = 500;

/**
 * Модальное окно коллег по отделу.
 *
 * Данные запрашиваются у бэкенда по точному фильтру department
 * (в исходной версии модалка фильтровала «все загруженные контакты»,
 * что ломалось при серверном поиске с ограничением выдачи).
 */
export function DepartmentModal({ isOpen, onClose, department, organization, onSelectContact }: DepartmentModalProps) {
  const { t } = useTranslation();
  const testMode = useAppStore((state) => state.testMode);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const { data: page, isLoading } = useQuery({
    queryKey: ['contacts', 'department', department, organization, testMode],
    queryFn: () =>
      getContactsService().search({
        activeTab: 'global',
        department: department ?? undefined,
        organization,
        limit: DEPARTMENT_LIMIT,
      }),
    enabled: isOpen && Boolean(department),
    staleTime: 60_000,
  });

  const departmentContacts = page?.contacts ?? [];

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, department, organization]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return departmentContacts;
    }
    return departmentContacts.filter(
      (contact) => contact.fullName.toLowerCase().includes(query) || contact.jobTitle?.toLowerCase().includes(query),
    );
  }, [departmentContacts, search]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedContacts = useMemo(
    () => filteredContacts.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredContacts, startIndex],
  );

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <FocusLock returnFocus>
          <div
            className="fixed inset-0 top-[32px] z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={department ?? undefined}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 15 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-surface rounded-[24px] shadow-2xl overflow-hidden flex flex-col ring-1 ring-border w-full max-w-[500px] h-[75vh] max-h-[640px] z-10"
            >
              <div className="flex flex-col gap-4 p-5 pb-4 border-b border-border bg-surface-hover shrink-0">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex flex-col justify-center min-w-0">
                    <h2 className="text-[20px] font-bold text-foreground leading-tight line-clamp-2">{department}</h2>
                    {organization && (
                      <p className="text-[14px] text-muted-foreground font-medium mt-1 flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{organization}</span>
                      </p>
                    )}
                  </div>
                  <IconButton
                    onClick={onClose}
                    icon={X}
                    aria-label={t('close')}
                    className="bg-transparent hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
                  />
                </div>

                <div className="relative">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground pointer-events-none"
                    aria-hidden
                  />
                  <AutoFocusInside>
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={t('searchByDepartment')}
                      aria-label={t('searchByDepartment')}
                      className="w-full h-[44px] pl-10 pr-4 rounded-[12px] bg-input border border-border text-foreground text-[15px] outline-none transition-all placeholder:text-muted-foreground"
                    />
                  </AutoFocusInside>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-background">
                {isLoading ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    {t('loading')}
                  </div>
                ) : paginatedContacts.length > 0 ? (
                  <div className="flex flex-col">
                    {paginatedContacts.map((contact) => (
                      <button
                        type="button"
                        key={contact.id}
                        onClick={() => {
                          onSelectContact(contact.id);
                          onClose();
                        }}
                        className="flex items-center gap-3 p-4 border-b border-border last:border-b-0 cursor-pointer transition-colors outline-none hover:bg-surface-hover active:bg-surface-active group text-left w-full"
                      >
                        <Avatar fullName={contact.fullName} size="sm" className="w-[42px] h-[42px] shadow-sm" />
                        <span className="flex-1 min-w-0 flex flex-col justify-center">
                          <span className="text-[16px] font-bold text-foreground truncate mb-0.5 group-hover:text-primary transition-colors">
                            {contact.fullName}
                          </span>
                          <span className="text-[14px] text-muted-foreground truncate flex items-center gap-1.5">
                            <Briefcase className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{contact.jobTitle || t('employee')}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 text-center h-full">
                    <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center text-muted-foreground mb-4 border border-border">
                      <Search className="w-6 h-6" aria-hidden />
                    </div>
                    <h3 className="text-[16px] font-bold text-foreground mb-1">{t('noResultsInDept')}</h3>
                    <p className="text-[14px] text-muted-foreground max-w-[200px]">{t('tryAnotherSearch')}</p>
                  </div>
                )}
              </div>

              {filteredContacts.length > PAGE_SIZE && (
                <div className="border-t border-border bg-surface-hover px-6 py-3.5 flex flex-col sm:flex-row gap-3 items-center justify-between shrink-0 select-none">
                  <div className="text-[13px] font-medium text-muted-foreground">
                    {t('pagination.showingOf', {
                      start: startIndex + 1,
                      end: Math.min(startIndex + PAGE_SIZE, filteredContacts.length),
                      total: filteredContacts.length,
                    })}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      aria-label={t('back')}
                      className="p-1.5 rounded-[8px] border border-border bg-surface text-foreground hover:bg-input disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center"
                    >
                      <ChevronLeft className="w-4 h-4" aria-hidden />
                    </button>
                    {pageNumbers(currentPage, totalPages).map((page, index) =>
                      page === 'ellipsis' ? (
                        <span key={`ellipsis-${index}`} className="px-1 text-[13px] text-muted-foreground">
                          …
                        </span>
                      ) : (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          aria-current={currentPage === page ? 'page' : undefined}
                          className={cn(
                            'w-8 h-8 rounded-[8px] text-[13px] font-bold transition-all flex items-center justify-center cursor-pointer',
                            currentPage === page
                              ? 'bg-primary text-white shadow-sm'
                              : 'text-foreground/70 hover:bg-input hover:text-foreground',
                          )}
                        >
                          {page}
                        </button>
                      ),
                    )}
                    <button
                      type="button"
                      onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      aria-label={t('next')}
                      className="p-1.5 rounded-[8px] border border-border bg-surface text-foreground hover:bg-input disabled:opacity-40 transition-all cursor-pointer flex items-center justify-center"
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </FocusLock>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Номера страниц с «…»: 1 … 4 5 6 … 20. */
function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  const pages = new Set<number>([1, total]);
  for (let page = current - 1; page <= current + 1; page += 1) {
    if (page >= 1 && page <= total) {
      pages.add(page);
    }
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'ellipsis')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (page - previous > 1) {
      result.push('ellipsis');
    }
    result.push(page);
    previous = page;
  }
  return result;
}
