import { TriangleAlert } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import { formatRelativeTime } from '@/lib/utils';

export interface SyncMetaLineProps {
  organization: string;
  syncStates: {
    organization: string;
    lastSyncAt: number | null;
    lastCount: number | null;
    lastError: string | null;
  }[];
  locale: string;
}

/** Строка состояния последней синхронизации организации. */
export function SyncMetaLine({ organization, syncStates, locale }: SyncMetaLineProps) {
  const { t } = useTranslation();
  const meta = syncStates.find((state) => state.organization === organization);
  if (!organization || !meta) {
    return null;
  }

  if (meta.lastError) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-red-500 font-medium min-w-0" title={meta.lastError}>
        <TriangleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
        <span className="truncate">{meta.lastError}</span>
      </span>
    );
  }
  if (meta.lastSyncAt) {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-medium">
        {t('sync.lastSync', { time: formatRelativeTime(meta.lastSyncAt, locale) })}
        {meta.lastCount !== null && ` · ${t('sync.records', { count: meta.lastCount })}`}
      </span>
    );
  }
  return <span className="text-[12px] text-muted-foreground font-medium">{t('sync.never')}</span>;
}
