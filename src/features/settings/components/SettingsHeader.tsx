import { ArrowLeft } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/ui/IconButton';

interface SettingsHeaderProps {
  title: string;
  onBack: () => void;
}

/**
 * A shared header for settings sections.
 *
 * Extracted into a shared component so that all sections (main, Active Directory,
 * "About") are aligned pixel-for-pixel: each section
 * kept its own copy of the markup and the headers "rode" relative to each other.
 */
export function SettingsHeader({ title, onBack }: SettingsHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-5 mb-2 relative z-10 shrink-0">
      <IconButton onClick={onBack} icon={ArrowLeft} aria-label={t('back')} />
      <h1 className="text-[26px] font-bold tracking-tight m-0 leading-none">{title}</h1>
    </div>
  );
}
