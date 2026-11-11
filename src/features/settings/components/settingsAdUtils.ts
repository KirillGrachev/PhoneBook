import type { LdapOrgConfigDto, LdapOrgInput } from '@/api/contracts';
import { cn } from '@/lib/utils';

/** Схема LDAP-URL: 'ldap' | 'ldaps' | null. */
export function urlScheme(url: string): 'ldap' | 'ldaps' | null {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('ldaps://')) return 'ldaps';
  if (normalized.startsWith('ldap://')) return 'ldap';
  return null;
}

export function toInput(config: LdapOrgConfigDto): LdapOrgInput {
  return {
    organization: config.organization,
    ldapUrl: config.ldapUrl,
    baseDn: config.baseDn,
    bindDn: config.bindDn ?? null,
    useStartTls: config.useStartTls,
    allowInvalidTls: config.allowInvalidTls,
    useIntegratedAuth: config.useIntegratedAuth,
  };
}

/** Основная кнопка; в disabled — нейтральный стиль, а не «полупрозрачный primary». */
export function primaryButton(disabled: boolean, extra?: string): string {
  return cn(
    'flex items-center justify-center gap-2 rounded-[10px] text-[13px] font-bold transition-colors',
    disabled
      ? 'bg-input text-muted-foreground border border-border cursor-not-allowed'
      : 'bg-primary text-white hover:bg-primary-hover cursor-pointer',
    extra,
  );
}
