import { Lock } from '@/components/icons';
import { useTranslation } from 'react-i18next';

import type { LdapOrgConfigDto } from '@/api/contracts';
import { TextField } from '@/components/ui/TextField';

import { primaryButton } from './settingsAdUtils';

interface SettingsAdPasswordEditorProps {
  config: LdapOrgConfigDto;
  password: string;
  disabled: boolean;
  onPasswordChange: (value: string) => void;
  onSave: () => void;
}

/** Пароль bind-учётки: отдельный защищённый канал, не через стор. */
export function SettingsAdPasswordEditor({
  config,
  password,
  disabled,
  onPasswordChange,
  onSave,
}: SettingsAdPasswordEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={t('settings.ad.password')}
        type="password"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
        placeholder={config.hasPassword ? t('settings.ad.passwordSaved') : t('settings.ad.passwordPlaceholder')}
        autoComplete="new-password"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className={primaryButton(disabled, 'px-3 py-1.5 text-[14px]')}
        >
          <Lock className="w-4 h-4" aria-hidden />
          {t('settings.ad.savePassword')}
        </button>
        {config.hasPassword && (
          <button
            type="button"
            onClick={onSave}
            className="px-3 py-1.5 rounded-[10px] border border-border text-foreground/70 text-[14px] font-semibold hover:bg-surface-hover transition-colors cursor-pointer"
          >
            {t('settings.ad.clearPassword')}
          </button>
        )}
      </div>
    </div>
  );
}
