import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { useAppStore } from '@/store/useAppStore';
import '@/lib/i18n';

import { SettingsExternalView } from '../SettingsExternalView';

vi.mock('@/api/directory', () => ({
  configApi: {
    refreshExternalPhonebook: vi.fn(),
    pickExternalPhonebookFiles: vi.fn(),
  },
}));

vi.mock('@/store/configStorage', () => ({
  configStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  flushConfigSave: vi.fn(),
}));

describe('SettingsExternalView: accessibility', () => {
  it('has no axe violations', async () => {
    useAppStore.setState({ externalPhonebookPaths: [], externalPhonebookEnabled: false });
    const client = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={client}>
        <SettingsExternalView />
      </QueryClientProvider>,
    );

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
