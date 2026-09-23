import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/components/ui/IconButton';

interface SettingsHeaderProps {
  title: string;
  onBack: () => void;
}

/**
 * Единая шапка разделов настроек.
 *
 * Вынесена в общий компонент, чтобы все разделы (основной, Active Directory,
 * «О программе») выровнены пиксель-в-пиксель: каждый раздел
 * держал свою копию разметки и шапки «ездили» друг относительно друга.
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
