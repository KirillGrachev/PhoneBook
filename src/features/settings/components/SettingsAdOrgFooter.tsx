import { Loader2, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { primaryButton } from './settingsAdUtils';
import { SyncMetaLine, type SyncMetaLineProps } from './SyncMetaLine';

interface SettingsAdOrgFooterProps {
  organization: string;
  testing: boolean;
  busy: boolean;
  locale: string;
  syncStates: SyncMetaLineProps['syncStates'];
  onTest: () => void;
}

/** Кнопка проверки подключения и статус последней синхронизации. */
export function SettingsAdOrgFooter({
  organization,
  testing,
  busy,
  locale,
  syncStates,
  onTest,
}: SettingsAdOrgFooterProps) {
  const { t } = useTranslation();

  return (
    <footer className="flex flex-col items-center gap-2 pt-3 border-t border-border/60">
      <button type="button" onClick={onTest} disabled={busy} className={primaryButton(busy, 'px-4 py-2')}>
        {testing ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : (
          <PlugZap className="w-4 h-4" aria-hidden />
        )}
        {testing ? t('settings.ad.testing') : t('settings.ad.test')}
      </button>
      <SyncMetaLine organization={organization} syncStates={syncStates} locale={locale} />
    </footer>
  );
}
