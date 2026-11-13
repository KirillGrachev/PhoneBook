import { useTranslation } from 'react-i18next';

import type { LdapOrgConfigDto } from '@/api/contracts';
import { Switch } from '@/components/ui/Switch';

interface SettingsAdAuthToggleProps {
  config: LdapOrgConfigDto;
  onChange: (patch: Partial<LdapOrgConfigDto>) => void;
}

/** Переключатель встроенной аутентификации Windows. */
export function SettingsAdAuthToggle({ config, onChange }: SettingsAdAuthToggleProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 pt-1">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold text-foreground">{t('settings.ad.integratedAuth')}</span>
          <span className="text-[13px] text-muted-foreground">{t('settings.ad.integratedAuthDesc')}</span>
        </span>
        <Switch
          checked={config.useIntegratedAuth}
          onChange={(checked) => onChange({ useIntegratedAuth: checked })}
          ariaLabel={t('settings.ad.integratedAuth')}
        />
      </label>
      {config.useIntegratedAuth && (
        <span className="text-[13px] text-muted-foreground leading-snug">{t('settings.ad.integratedAuthHint')}</span>
      )}
    </div>
  );
}
