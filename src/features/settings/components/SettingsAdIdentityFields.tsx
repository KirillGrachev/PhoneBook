import { useTranslation } from 'react-i18next';

import type { LdapOrgConfigDto } from '@/api/contracts';
import { TextField } from '@/components/ui/TextField';

import { urlScheme } from './settingsAdUtils';

interface SettingsAdIdentityFieldsProps {
  config: LdapOrgConfigDto;
  onChange: (patch: Partial<LdapOrgConfigDto>) => void;
}

/** Идентификация подключения: организация, LDAP URL, Base DN. */
export function SettingsAdIdentityFields({ config, onChange }: SettingsAdIdentityFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <TextField
        label={t('settings.ad.organization')}
        value={config.organization}
        onChange={(event) => onChange({ organization: event.target.value })}
        placeholder={t('settings.ad.organizationPlaceholder')}
        autoComplete="off"
      />
      <TextField
        label={t('settings.ad.ldapUrl')}
        value={config.ldapUrl}
        onChange={(event) => onChange({ ldapUrl: event.target.value })}
        placeholder="ldap://dc1.kmaruda.ru, ldaps://dc2.kmaruda.ru:636"
        className="font-mono"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        hint={
          [
            urlScheme(config.ldapUrl) === 'ldaps'
              ? t('settings.ad.schemeLdaps')
              : urlScheme(config.ldapUrl) === 'ldap'
                ? t('settings.ad.schemeLdap')
                : null,
            t('settings.ad.dcFailoverHint'),
          ]
            .filter(Boolean)
            .join(' ')
        }
      />
      <TextField
        label={t('settings.ad.baseDn')}
        value={config.baseDn}
        onChange={(event) => onChange({ baseDn: event.target.value })}
        placeholder="DC=kmaruda,DC=ru"
        hint={t('settings.ad.baseDnHint')}
        className="font-mono"
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
      />
    </>
  );
}
