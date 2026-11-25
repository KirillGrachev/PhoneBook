import { BookmarkCheck, BookmarkMinus, Main, MessageCircle } from '@/components/icons';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { useContactPhoto } from '@/features/contacts/hooks/useContactData';
import { devLog } from '@/lib/devlog';
import { personNameForLanguage } from '@/lib/transliteration';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

interface ContactHeaderProps {
  contact: Contact;
  /** "Write": if there is no email, the parent opens the address input dialog. */
  onWrite: () => void;
  onActionClick: (type: 'mailto' | 'trueconf', url: string) => void;
}

/** The contact card header: avatar, name, actions, "add to my contacts". */
export function ContactHeader({ contact, onWrite, onActionClick }: ContactHeaderProps) {
  const { t, i18n } = useTranslation();
  const displayName = personNameForLanguage(contact.fullName, i18n.language);
  const { data: photoUrl } = useContactPhoto(contact.id);
  // Favorite state is read directly from the store so the button always reflects
  // the latest savedContactIds, even if the parent re-renders with a stale prop.
  const isSaved = useAppStore((state) => state.savedContactIds.includes(contact.id));
  const toggleSavedContact = useAppStore((state) => state.toggleSavedContact);
  const details = [contact.jobTitle, contact.department, contact.organization].filter((value): value is string =>
    Boolean(value && value.trim()),
  );

  const handleToggleSave = () => {
    devLog('favorite', { id: contact.id, name: displayName, saved: !isSaved });
    toggleSavedContact(contact.id);
    if (isSaved) {
      toast.success(t('removedFromContacts', { name: displayName }), {
        id: 'favorite-toggle-toast',
        description: t('contactRemovedDesc'),
      });
    } else {
      toast.success(t('addedToContacts', { name: displayName }), {
        id: 'favorite-toggle-toast',
        description: t('contactSavedDesc'),
      });
    }
  };

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 sm:gap-8 mb-6 sm:mb-8 pb-6 border-b border-border mt-4 md:mt-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6">
        <Avatar fullName={displayName} photoUrl={photoUrl} size="md" className="shadow-sm ring-4 ring-surface" />
        <div className="min-w-0">
          <h2 className="text-[22px] sm:text-[28px] font-semibold text-foreground mb-1.5 leading-tight break-words select-text">
            {displayName}
          </h2>
          {details.length > 0 && (
            <div className="text-muted-foreground text-[15px] leading-snug select-text">
              {details.map((line, index) => (
                <p key={`${index}-${line}`} className="m-0">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 w-full min-w-0 md:w-auto md:min-w-[280px]">
        <div className="flex flex-row gap-3">
          <button
            type="button"
            onClick={onWrite}
            className="flex flex-1 items-center justify-center gap-2 h-[40px] rounded-[10px] bg-primary hover:bg-primary-hover text-white transition-all duration-300 cursor-pointer shadow-sm min-w-0 px-2 no-ring"
          >
            <Main className="w-[16px] h-[16px] shrink-0" aria-hidden />
            <span className="text-[14px] font-medium leading-none select-none truncate">{t('write')}</span>
          </button>
          {contact.trueconfId && (
            <button
              type="button"
              onClick={() => {
                // The official TrueConf scheme: a chat with a user is `<id>&do=chat`.
                // ID is the AD `pager` attribute AS IS: the value already contains the domain
                // of the TrueConf server (`login@kma-meet.metholding.com`); without this
                // tail the server will not understand which chat to open. An empty pager -
                // there is no button at all.
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
              <BookmarkMinus className="w-[16px] h-[16px] shrink-0" aria-hidden />
              <span className="text-[14px] font-medium leading-none select-none">{t('inContacts')}</span>
            </>
          ) : (
            <>
              <BookmarkCheck className="w-[16px] h-[16px] shrink-0" aria-hidden />
              <span className="text-[14px] font-medium leading-none select-none">{t('addToContacts')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
