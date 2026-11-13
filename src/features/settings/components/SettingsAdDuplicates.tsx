import { useTranslation } from 'react-i18next';

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

  return (
    <>
      <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
        <h3 className="text-[14px] font-bold text-muted-foreground uppercase">{t('settings.ad.duplicatesTitle')}</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed">{t('settings.ad.duplicatesDesc')}</p>
        <button
          type="button"
          onClick={onCheck}
          disabled={busy !== null || testMode}
          className={primaryButton(busy !== null || testMode, 'w-full h-11 text-[15px]')}
        >
          {busy === 'preview' ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />
          ) : (
            <Trash className="w-[18px] h-[18px]" aria-hidden />
          )}
          {t('settings.ad.duplicatesCheck')}
        </button>
      </section>

      {preview && (
        <div
          className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center p-4"
          role="alertdialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
          <div className="relative bg-surface w-full max-w-[420px] rounded-[20px] shadow-2xl border border-border p-6 flex flex-col gap-4 z-10">
            <h3 className="text-[18px] font-bold text-foreground m-0">{t('settings.ad.duplicatesConfirmTitle')}</h3>
            <p className="text-[14px] text-muted-foreground leading-relaxed m-0">
              {t('settings.ad.duplicatesConfirmMsg', {
                groups: preview.groups,
                records: preview.removable,
                samples: preview.samples.join(', '),
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-[12px] text-[14px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer"
              >
                {t('settings.orgGroupsCancel')}
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={busy !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-[12px] bg-primary text-white text-[14px] font-bold hover:bg-primary-hover transition-colors outline-none cursor-pointer disabled:opacity-60"
              >
                {busy === 'apply' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {t('settings.ad.duplicatesApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
