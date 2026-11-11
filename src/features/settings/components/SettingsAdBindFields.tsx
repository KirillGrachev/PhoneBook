import { useTranslation } from 'react-i18next';

import type { LdapOrgConfigDto } from '@/api/contracts';
import { TextField } from '@/components/ui/TextField';

import { SettingsAdPasswordEditor } from './SettingsAdPasswordEditor';

interface SettingsAdBindFieldsProps {
  config: LdapOrgConfigDto;
  password: string;
  disabled: boolean;
  onChange: (patch: Partial<LdapOrgConfigDto>) => void;
  onPasswordChange: (value: string) => void;
  onSave: () => void;
}

/** Bind DN и пароль сервисной учётки. */
export function SettingsAdBindFields({
  config,
  password,
  disabled,
  onChange,
  onPasswordChange,
  onSave,
}: SettingsAdBindFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <TextField
        label={t('settings.ad.bindDn')}
        value={config.bindDn ?? ''}
        onChange={(event) => onChange({ bindDn: event.target.value || null })}
        placeholder="svc_phonebook@kmaruda.ru"
        hint={t('settings.ad.bindDnHint')}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
      />
      <SettingsAdPasswordEditor
        config={config}
        password={password}
        disabled={disabled}
        onPasswordChange={onPasswordChange}
        onSave={onSave}
      />
    </>
  );
}
