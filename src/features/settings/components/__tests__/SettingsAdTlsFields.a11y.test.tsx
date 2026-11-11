import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import type { LdapOrgConfigDto } from '@/api/contracts';
import '@/lib/i18n';

import { SettingsAdTlsFields } from '../SettingsAdTlsFields';

const config: LdapOrgConfigDto = {
  organization: 'KMA',
  ldapUrl: 'ldap://dc1',
  baseDn: 'DC=kma,DC=ru',
  bindDn: null,
  useStartTls: true,
  allowInvalidTls: false,
  useIntegratedAuth: true,
  hasPassword: false,
};

describe('SettingsAdTlsFields: доступность', () => {
  it('не имеет нарушений axe', async () => {
    const { container } = render(<SettingsAdTlsFields config={config} onChange={() => {}} />);
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
