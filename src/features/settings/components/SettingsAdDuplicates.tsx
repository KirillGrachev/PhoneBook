import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import FocusLock from '@/components/ui/FocusLock';
import { Loader2, Trash } from '@/components/icons';
import type { DuplicatesPreviewDto } from '@/api/contracts';

import { primaryButton } from './settingsAdUtils';

interface SettingsAdDuplicatesProps {
  testMode: boolean;
  busy: 'preview' | 'apply' | null;
  preview: DuplicatesPreviewDto | null;
  onCheck: () => void;
  onApply: () => void;
  onClose: () => void;
}

/** Duplicate-cleanup action and confirmation dialog. */
export function SettingsAdDuplicates({
  testMode,
  busy,
  preview,
  onCheck,
  onApply,
  onClose,
}: SettingsAdDuplicatesProps) {
  const { t } = useTranslation();

  // Keep the trigger focusable while the preview is loading: natively disabling
  // the clicked button drops focus, and the focus trap would then move focus to
  // the first settings control. aria-disabled preserves the focus position.
  const checkBlocked = busy !== null || testMode;
  const applyBlocked = busy !== null;
  const closeBlocked = busy === 'apply';

  // Up to seven records are listed in full; beyond that, show six names and a
  // counter for the rest so the dialog stays compact.
  const visibleNames = preview
    ? preview.removable > 7
      ? preview.removableNames.slice(0, 6)
      : preview.removableNames
    : [];
  const hiddenCount = preview ? Math.max(preview.removable - visibleNames.length, 0) : 0;
  const names =
    visibleNames.join(', ') +
    (hiddenCount > 0 ? ` ${t('settings.ad.duplicatesConfirmMore', { count: hiddenCount })}` : '');

  const handleClose = () => {
    if (!closeBlocked) {
      onClose();
    }
  };

  return (
    <>
      <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
        <h3 className="text-[14px] font-bold text-muted-foreground uppercase">{t('settings.ad.duplicatesTitle')}</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed">{t('settings.ad.duplicatesDesc')}</p>
        <button
          type="button"
          onClick={() => {
            if (!checkBlocked) {
              onCheck();
            }
          }}
          disabled={testMode}
          aria-disabled={checkBlocked}
          aria-busy={busy === 'preview'}
          className={primaryButton(checkBlocked, 'w-full h-11 text-[15px]')}
        >
          {busy === 'preview' ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />
          ) : (
            <Trash className="w-[18px] h-[18px]" aria-hidden />
          )}
          {t('settings.ad.duplicatesCheck')}
        </button>
      </section>

      {preview &&
        typeof document !== 'undefined' &&
        createPortal(
          <FocusLock returnFocus={{ preventScroll: true }} focusOptions={{ preventScroll: true }}>
            <div
              className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center p-4"
              role="alertdialog"
              aria-modal="true"
            >
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
              <div className="relative bg-surface w-full max-w-[420px] rounded-[20px] shadow-2xl border border-border p-6 flex flex-col gap-4 z-10">
                <h3 className="text-[18px] font-bold text-foreground m-0">{t('settings.ad.duplicatesConfirmTitle')}</h3>
                <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-muted-foreground">
                  <p className="m-0 font-semibold text-foreground">
                    {t('settings.ad.duplicatesConfirmGroups', { count: preview.groups })}
                  </p>
                  <p className="m-0">{t('settings.ad.duplicatesConfirmRemovable', { count: preview.removable })}</p>
                  {visibleNames.length > 0 && (
                    <p className="m-0 text-[13px]">{t('settings.ad.duplicatesConfirmNames', { names })}</p>
                  )}
                  <p className="m-0 text-[13px]">{t('settings.ad.duplicatesConfirmNote')}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    aria-disabled={closeBlocked}
                    className="px-4 py-2 rounded-[12px] text-[14px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                  >
                    {t('settings.orgGroupsCancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!applyBlocked) {
                        onApply();
                      }
                    }}
                    aria-disabled={applyBlocked}
                    aria-busy={busy === 'apply'}
                    className="flex items-center gap-2 px-4 py-2 rounded-[12px] bg-primary text-white text-[14px] font-bold hover:bg-primary-hover transition-colors outline-none cursor-pointer aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
                  >
                    {busy === 'apply' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    {t('settings.ad.duplicatesApply')}
                  </button>
                </div>
              </div>
            </div>
          </FocusLock>,
          document.body,
        )}
    </>
  );
}
