import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/lib/i18n';

import { SyncMetaLine } from '../SyncMetaLine';

const longError =
  'Сервер требует аутентификацию. Заполните поля «Учётная запись» и «Пароль» в настройках Active Directory и сохраните пароль. Подробности: 000004DC: LdapErr: DSID-0C090A5C, comment: In order to perform this operation a successful bind must be completed on the connection.';

describe('SyncMetaLine', () => {
  it('wraps a long synchronization error inside the card instead of truncating it off-screen', () => {
    render(
      <SyncMetaLine
        organization="КМАруда"
        locale="ru"
        syncStates={[
          {
            organization: 'КМАруда',
            lastSyncAt: null,
            lastCount: null,
            lastError: longError,
          },
        ]}
      />,
    );

    const text = screen.getByText(longError);
    expect(text).toHaveClass('break-words');
    expect(text.className).not.toContain('truncate');
    expect(screen.getByTitle(longError)).toBeInTheDocument();
  });
});
