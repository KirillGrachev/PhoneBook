import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTransferView } from '../SettingsTransferView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const exportConfigFile = vi.fn();
const parseConfigFile = vi.fn();

vi.mock('@/api/directory', () => ({
  configApi: {
    exportConfigFile: (...args: unknown[]) => exportConfigFile(...args),
    parseConfigFile: (...args: unknown[]) => parseConfigFile(...args),
  },
}));

// Config persistence is not needed in tests: we check the screen markup, not the bridge to Rust.
vi.mock('@/store/configStorage', () => ({
  configStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  flushConfigSave: vi.fn(),
}));

function renderView() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SettingsTransferView />
    </QueryClientProvider>,
  );
}

describe('SettingsTransferView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('раздел не дублирует заголовок страницы внутри содержимого', () => {
    renderView();

    // The screen title is rendered only by the shared SettingsHeader;
    // there must be no repeated header within a section.
    expect(screen.queryAllByText('settings.transferTitle')).toHaveLength(0);
  });

  it('кнопки экспорта и импорта доступны сразу, описание раздела на месте', () => {
    renderView();

    expect(screen.getByRole('button', { name: 'settings.transferExport' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'settings.transferImport' })).toBeEnabled();
    expect(screen.getByText('settings.transferDesc')).toBeTruthy();
  });
});
