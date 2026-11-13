import { useTranslation } from 'react-i18next';

import { Loader2, Refresh } from '@/components/icons';
import { Select } from '@/components/ui/Select';
import { TextField } from '@/components/ui/TextField';

import { primaryButton } from './settingsAdUtils';

const SYNC_INTERVAL_OPTIONS = [1, 6, 12, 24, 72, 168];

interface SettingsAdSyncCardProps {
  syncIntervalHours: number;
  onSyncIntervalChange: (hours: number) => void;
  connectTimeoutSecs: number;
  onConnectTimeoutChange: (seconds: number) => void;
  operationTimeoutSecs: number;
  onOperationTimeoutChange: (seconds: number) => void;
  testMode: boolean;
  syncRunning: boolean;
  onSyncNow: () => void;
}

/** Sync interval, LDAP timeouts and manual sync button. */
export function SettingsAdSyncCard({
  syncIntervalHours,
  onSyncIntervalChange,
  connectTimeoutSecs,
  onConnectTimeoutChange,
  operationTimeoutSecs,
  onOperationTimeoutChange,
  testMode,
  syncRunning,
  onSyncNow,
}: SettingsAdSyncCardProps) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
      <h3 className="text-[14px] font-bold text-muted-foreground uppercase">{t('settings.ad.lastSyncTitle')}</h3>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold text-foreground">{t('settings.ad.syncInterval')}</span>
        <Select
          value={syncIntervalHours}
          onChange={onSyncIntervalChange}
          ariaLabel={t('settings.ad.syncInterval')}
          options={SYNC_INTERVAL_OPTIONS.map((hours) => ({
            value: hours,
            label: t('settings.ad.syncIntervalHours', { count: hours }),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          type="number"
          min={1}
          max={300}
          label={t('settings.ad.connectTimeout')}
          hint={t('settings.ad.connectTimeoutHint')}
          value={connectTimeoutSecs}
          onChange={(event) => onConnectTimeoutChange(Math.min(300, Math.max(1, Number(event.target.value) || 1)))}
        />
        <TextField
          type="number"
          min={1}
          max={300}
          label={t('settings.ad.operationTimeout')}
          hint={t('settings.ad.operationTimeoutHint')}
          value={operationTimeoutSecs}
          onChange={(event) => onOperationTimeoutChange(Math.min(300, Math.max(1, Number(event.target.value) || 1)))}
        />
      </div>

      <button
        type="button"
        onClick={onSyncNow}
        disabled={testMode || syncRunning}
        className={primaryButton(testMode || syncRunning, 'w-full h-11 mt-1 text-[15px]')}
      >
        {syncRunning ? (
          <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden />
        ) : (
          <Refresh className="w-[18px] h-[18px]" aria-hidden />
        )}
        {syncRunning ? t('sync.running') : t('sync.now')}
      </button>
    </section>
  );
}
