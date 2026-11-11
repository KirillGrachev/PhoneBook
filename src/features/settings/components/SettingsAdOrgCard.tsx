import type { LdapOrgConfigDto } from '@/api/contracts';

import type { SyncMetaLineProps } from './SyncMetaLine';
import { SettingsAdAuthToggle } from './SettingsAdAuthToggle';
import { SettingsAdBindFields } from './SettingsAdBindFields';
import { SettingsAdIdentityFields } from './SettingsAdIdentityFields';
import { SettingsAdOrgFooter } from './SettingsAdOrgFooter';
import { SettingsAdOrgHeader } from './SettingsAdOrgHeader';
import { SettingsAdTlsFields } from './SettingsAdTlsFields';

interface SettingsAdOrgCardProps {
  config: LdapOrgConfigDto;
  index: number;
  passwordDraft: string;
  testing: boolean;
  busy: boolean;
  locale: string;
  syncStates: SyncMetaLineProps['syncStates'];
  onChange: (patch: Partial<LdapOrgConfigDto>) => void;
  onPasswordChange: (value: string) => void;
  onSavePassword: () => void;
  onRemove: () => void;
  onTest: () => void;
}

/** Карточка одной организации AD. */
export function SettingsAdOrgCard({
  config,
  index,
  passwordDraft,
  testing,
  busy,
  locale,
  syncStates,
  onChange,
  onPasswordChange,
  onSavePassword,
  onRemove,
  onTest,
}: SettingsAdOrgCardProps) {
  const disabled = !config.organization.trim() || !passwordDraft.trim();

  return (
    <article className="flex flex-col gap-3 p-4 border border-border bg-surface rounded-[16px] shadow-sm">
      <SettingsAdOrgHeader organization={config.organization} index={index} onRemove={onRemove} />
      <SettingsAdIdentityFields config={config} onChange={onChange} />
      <SettingsAdAuthToggle config={config} onChange={onChange} />
      {!config.useIntegratedAuth && (
        <SettingsAdBindFields
          config={config}
          password={passwordDraft}
          disabled={disabled}
          onChange={onChange}
          onPasswordChange={onPasswordChange}
          onSave={onSavePassword}
        />
      )}
      <SettingsAdTlsFields config={config} onChange={onChange} />
      <SettingsAdOrgFooter
        organization={config.organization}
        testing={testing}
        busy={busy}
        locale={locale}
        syncStates={syncStates}
        onTest={onTest}
      />
    </article>
  );
}
