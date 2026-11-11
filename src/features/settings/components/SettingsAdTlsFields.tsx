import { ShieldAlert } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import type { LdapOrgConfigDto } from '@/api/contracts';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils';

import { urlScheme } from './settingsAdUtils';

interface SettingsAdTlsFieldsProps {
  config: LdapOrgConfigDto;
  onChange: (patch: Partial<LdapOrgConfigDto>) => void;
}

/** StartTLS и отключение проверки сертификата. */
export function SettingsAdTlsFields({ config, onChange }: SettingsAdTlsFieldsProps) {
  const { t } = useTranslation();
  const ldaps = urlScheme(config.ldapUrl) === 'ldaps';

  return (
    <div className="flex flex-col gap-2 pt-1">
      <label className={cn('flex items-center justify-between gap-3', ldaps ? 'opacity-60' : 'cursor-pointer')}>
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-foreground">{t('settings.ad.useStartTls')}</span>
          <span className="text-[12px] text-muted-foreground">
            {ldaps ? t('settings.ad.startTlsNotNeeded') : t('settings.ad.useStartTlsDesc')}
          </span>
        </span>
        <Switch
          checked={ldaps ? false : config.useStartTls}
          disabled={ldaps}
          onChange={(checked) => onChange({ useStartTls: checked })}
          ariaLabel={t('settings.ad.useStartTls')}
        />
      </label>
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-foreground flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" aria-hidden />
            {t('settings.ad.allowInvalidTls')}
          </span>
          <span className="text-[12px] text-muted-foreground">{t('settings.ad.allowInvalidTlsDesc')}</span>
        </span>
        <Switch
          checked={config.allowInvalidTls}
          onChange={(checked) => {
            if (checked && !window.confirm(t('settings.ad.allowInvalidTlsConfirm'))) {
              return;
            }
            onChange({ allowInvalidTls: checked });
          }}
          ariaLabel={t('settings.ad.allowInvalidTls')}
          activeClassName="bg-amber-500 border-amber-500"
        />
      </label>
    </div>
  );
}
