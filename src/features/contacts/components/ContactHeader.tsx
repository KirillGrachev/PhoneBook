import { BookmarkCheck, BookmarkPlus, Mail, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { devLog } from '@/lib/devlog';
import type { Contact } from '@/types';

interface ContactHeaderProps {
  contact: Contact;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
  /** «Написать»: если почты нет, родитель откроет диалог ввода адреса. */
  onWrite: () => void;
  onActionClick: (type: 'mailto' | 'trueconf', url: string) => void;
}

/** Шапка карточки контакта: аватар, ФИО, действия, «в мои контакты». */
export function ContactHeader({ contact, isSaved, onToggleSave, onWrite, onActionClick }: ContactHeaderProps) {
  const { t } = useTranslation();

  const handleToggleSave = () => {
    devLog('favorite', { id: contact.id, name: contact.fullName, saved: !isSaved });
    onToggleSave(contact.id);
    if (isSaved) {
      toast.success(t('removedFromContacts', { name: contact.fullName }), {
        id: 'favorite-toggle-toast',
        description: t('contactRemovedDesc'),
      });
    } else {
      toast.success(t('addedToContacts', { name: contact.fullName }), {
        id: 'favorite-toggle-toast',
        description: t('contactSavedDesc'),
      });
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 sm:gap-8 mb-6 sm:mb-8 pb-6 border-b border-border mt-4 md:mt-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6">
        <Avatar fullName={contact.fullName} size="md" className="shadow-sm ring-4 ring-surface" />
        <div className="min-w-0">
          <h2 className="text-[22px] sm:text-[28px] font-semibold text-foreground mb-1.5 leading-tight break-words select-text">
            {contact.fullName}
          </h2>
          <p className="text-muted-foreground text-[15px] leading-snug text-wrap select-text">
            {[contact.jobTitle, contact.department, contact.organization].filter(Boolean).join(' • ')}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 w-full min-w-0 md:w-auto md:min-w-[280px]">
        <div className="flex flex-row gap-3">
          <button
            type="button"
            onClick={onWrite}
            className="flex flex-1 items-center justify-center gap-2 h-[40px] rounded-[10px] bg-primary hover:bg-primary-hover text-white transition-all duration-300 cursor-pointer shadow-sm min-w-0 px-2 no-ring"
          >
            <Mail className="w-[16px] h-[16px] shrink-0" aria-hidden />
            <span className="text-[14px] font-medium leading-none select-none truncate">{t('write')}</span>
          </button>
          {contact.trueconfId && (
            <button
              type="button"
              onClick={() => {
                // Официальная схема TrueConf: чат с пользователем — `<id>&do=chat`.
                // ID — AD-атрибут `pager` КАК ЕСТЬ: значение уже содержит домен
                // TrueConf-сервера (`login@kma-meet.metholding.com`); без этого
                // хвоста сервер не поймёт, какой чат открыть. Пустой pager —
                // кнопки нет вовсе.
                const url = `trueconf:${contact.trueconfId}&do=chat`;
                devLog('trueconf', { trueconfId: contact.trueconfId, url });
                onActionClick('trueconf', url);
              }}
              className="flex flex-1 items-center justify-center gap-2 h-[40px] rounded-[10px] bg-[#1a78c2] hover:bg-[#135d96] text-white transition-all duration-300 cursor-pointer shadow-sm min-w-0 px-2 no-ring"
            >
              <MessageCircle className="w-[16px] h-[16px] shrink-0" aria-hidden />
              <span className="text-[14px] font-medium leading-none select-none truncate">{t('trueconf')}</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleToggleSave}
          className={`flex w-full items-center justify-center gap-2 h-[40px] rounded-[10px] transition-all duration-300 shadow-sm no-ring cursor-pointer ${
            isSaved
              ? 'bg-primary/15 text-primary hover:bg-primary/25 font-medium border-transparent'
              : 'bg-input border border-border text-foreground hover:bg-input-hover active:bg-input-hover'
          }`}
          aria-pressed={isSaved}
        >
          {isSaved ? (
            <>
              <BookmarkCheck className="w-[16px] h-[16px] shrink-0" aria-hidden />
              <span className="text-[14px] font-medium leading-none select-none">{t('inContacts')}</span>
            </>
          ) : (
            <>
              <BookmarkPlus className="w-[16px] h-[16px] shrink-0" aria-hidden />
              <span className="text-[14px] font-medium leading-none select-none">{t('addToContacts')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
