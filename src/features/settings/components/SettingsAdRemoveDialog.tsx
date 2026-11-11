import { useTranslation } from 'react-i18next';

interface SettingsAdRemoveDialogProps {
  organization: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Подтверждение удаления организации AD. */
export function SettingsAdRemoveDialog({ organization, onCancel, onConfirm }: SettingsAdRemoveDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 top-[32px] z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="bg-surface w-full max-w-[360px] rounded-[24px] p-6 shadow-2xl border border-border flex flex-col gap-4 text-center">
        <h3 className="text-[20px] font-bold text-foreground">{t('settings.ad.removeOrg')}</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed">
          {t('settings.ad.removeConfirm', { org: organization })}
        </p>
        <div className="flex justify-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-foreground/70 hover:bg-input transition-all border border-border bg-surface cursor-pointer"
          >
            {t('action.cancelBtn')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-[12px] text-[14px] font-bold text-white bg-red-500 hover:bg-red-600 transition-all cursor-pointer"
          >
            {t('settings.ad.removeOrg')}
          </button>
        </div>
      </div>
    </div>
  );
}
