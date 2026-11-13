import { Trash } from '@/components/icons';
import { useTranslation } from 'react-i18next';

interface SettingsAdOrgHeaderProps {
  organization: string;
  index: number;
  onRemove: () => void;
}

/** Заголовок карточки организации с кнопкой удаления. */
export function SettingsAdOrgHeader({ organization, index, onRemove }: SettingsAdOrgHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between">
      <h3 className="text-[14px] font-bold text-muted-foreground uppercase">{organization || `#${index + 1}`}</h3>
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center gap-2 text-[15px] font-semibold text-red-500 hover:text-red-600 transition-colors cursor-pointer bg-transparent border-0 p-1.5 outline-none"
        aria-label={t('settings.ad.removeOrg')}
      >
        <Trash className="w-5 h-5" aria-hidden />
        {t('settings.ad.removeOrg')}
      </button>
    </header>
  );
}
