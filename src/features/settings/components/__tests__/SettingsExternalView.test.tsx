import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '@/store/useAppStore';

import { SettingsExternalView } from '../SettingsExternalView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const refreshExternalPhonebook = vi.fn();
const pickExternalPhonebookFiles = vi.fn();

vi.mock('@/api/directory', () => ({
  configApi: {
    refreshExternalPhonebook: (...args: unknown[]) => refreshExternalPhonebook(...args),
    pickExternalPhonebookFiles: (...args: unknown[]) => pickExternalPhonebookFiles(...args),
  },
}));

// Config persistence is not needed in tests: we check the screen logic, not the bridge to Rust.
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
      <SettingsExternalView />
    </QueryClientProvider>,
  );
}

describe('SettingsExternalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshExternalPhonebook.mockResolvedValue({ state: 'disabled' });
    pickExternalPhonebookFiles.mockResolvedValue([]);
    useAppStore.setState({
      externalPhonebookPaths: [],
      externalPhonebookEnabled: false,
      externalPhonebookIntervals: {},
    });
  });

  it('тумблер без выбранного файла не отправляет запрос обновления', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));

    expect(useAppStore.getState().externalPhonebookEnabled).toBe(true);
    expect(refreshExternalPhonebook).not.toHaveBeenCalled();
    // The hint explains what is missing, instead of blinking buttons.
    expect(screen.getByText('settings.externalHintNeedFile')).toBeTruthy();
  });

  it('показывает отдельный выбор автообновления для каждого файла', () => {
    act(() =>
      useAppStore.setState({
        externalPhonebookPaths: ['C:/phonebook.xml'],
        externalPhonebookEnabled: true,
      }),
    );
    renderView();

    expect(screen.getByRole('button', { name: 'settings.externalRefreshEvery' })).toBeTruthy();
    expect(useAppStore.getState().externalPhonebookIntervals).toEqual({});
  });

  it('тумблер с заданным путём перезагружает файл в фоне', async () => {
    const user = userEvent.setup();
    act(() => useAppStore.setState({ externalPhonebookPaths: ['C:/phonebook.xml'] }));
    renderView();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));

    await waitFor(() => expect(refreshExternalPhonebook).toHaveBeenCalledTimes(1));
  });

  it('добавляет несколько выбранных файлов и перезагружает источники', async () => {
    const user = userEvent.setup();
    pickExternalPhonebookFiles.mockResolvedValue(['C:/phonebook-a.xml', 'C:/phonebook-b.xml']);
    renderView();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));
    await user.click(screen.getByRole('button', { name: 'settings.externalChoose' }));

    await waitFor(() =>
      expect(useAppStore.getState().externalPhonebookPaths).toEqual(['C:/phonebook-a.xml', 'C:/phonebook-b.xml']),
    );
    await waitFor(() => expect(refreshExternalPhonebook).toHaveBeenCalledTimes(1));
  });

  it('«Загрузить сейчас» недоступна без файла и при выключенном тумблере', async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeDisabled();

    // A path is set but the toggle is off — loading is still pointless.
    act(() => useAppStore.setState({ externalPhonebookPaths: ['C:/phonebook.xml'] }));
    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));
    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeEnabled();
  });

  it('при выключенном тумблере выбор файла заблокирован, состояние объяснено подсказкой', () => {
    renderView();

    // The switch is off and the file is absent: the entire file card is disabled.
    expect(screen.getByRole('button', { name: 'settings.externalChoose' })).toBeDisabled();
    expect(screen.getByText('settings.externalHintOff')).toBeTruthy();

    // The path is remembered from the last enable: the buttons are still inactive,
    // the hint changes to "path remembered - enable the switch".
    act(() => useAppStore.setState({ externalPhonebookPaths: ['C:/phonebook.xml'] }));
    expect(screen.getByRole('button', { name: 'settings.externalChoose' })).toBeDisabled();
    expect(screen.getByText('settings.externalHintDisabled')).toBeTruthy();
  });

  it('раздел не дублирует заголовок страницы внутри содержимого', () => {
    renderView();

    // The screen title is rendered only by the shared SettingsHeader;
    // there must be no repeated header within a section.
    expect(screen.queryAllByText('settings.externalTitle')).toHaveLength(0);
  });
});
