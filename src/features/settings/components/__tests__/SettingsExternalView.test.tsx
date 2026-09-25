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
const pickExternalPhonebookFile = vi.fn();

vi.mock('@/api/directory', () => ({
  configApi: {
    refreshExternalPhonebook: (...args: unknown[]) => refreshExternalPhonebook(...args),
    pickExternalPhonebookFile: (...args: unknown[]) => pickExternalPhonebookFile(...args),
  },
}));

// Персист конфигурации в тестах не нужен: проверяем логику экрана, а не мост к Rust.
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
    useAppStore.setState({ externalPhonebookPath: null, externalPhonebookEnabled: false });
  });

  it('тумблер без выбранного файла не отправляет запрос обновления', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));

    expect(useAppStore.getState().externalPhonebookEnabled).toBe(true);
    expect(refreshExternalPhonebook).not.toHaveBeenCalled();
    // Подсказка объясняет, чего не хватает, вместо мигающих кнопок.
    expect(screen.getByText('settings.externalHintNeedFile')).toBeTruthy();
  });

  it('тумблер с заданным путём перезагружает файл в фоне', async () => {
    const user = userEvent.setup();
    act(() => useAppStore.setState({ externalPhonebookPath: 'C:/phonebook.xml' }));
    renderView();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));

    await waitFor(() => expect(refreshExternalPhonebook).toHaveBeenCalledTimes(1));
  });

  it('«Загрузить сейчас» недоступна без файла и при выключенном тумблере', async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeDisabled();

    // Путь задан, но тумблер выключен — загрузка всё ещё бессмысленна.
    act(() => useAppStore.setState({ externalPhonebookPath: 'C:/phonebook.xml' }));
    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeDisabled();

    await user.click(screen.getByRole('switch', { name: 'settings.externalEnabled' }));
    expect(screen.getByRole('button', { name: 'settings.externalLoadNow' })).toBeEnabled();
  });

  it('при выключенном тумблере выбор файла заблокирован, состояние объяснено подсказкой', () => {
    renderView();

    // Рубильник выключен и файла нет: карточка файла неактивна целиком.
    expect(screen.getByRole('button', { name: 'settings.externalChoose' })).toBeDisabled();
    expect(screen.getByText('settings.externalHintOff')).toBeTruthy();

    // Путь запомнен с прошлого включения: кнопки по-прежнему неактивны,
    // подсказка меняется на «путь запомнен — включите тумблер».
    act(() => useAppStore.setState({ externalPhonebookPath: 'C:/phonebook.xml' }));
    expect(screen.getByRole('button', { name: 'settings.externalChoose' })).toBeDisabled();
    expect(screen.getByText('settings.externalHintDisabled')).toBeTruthy();
  });

  it('раздел не дублирует заголовок страницы внутри содержимого', () => {
    renderView();

    // Название экрана рендерит только общая шапка SettingsHeader;
    // внутри раздела повторного заголовка быть не должно.
    expect(screen.queryAllByText('settings.externalTitle')).toHaveLength(0);
  });
});
