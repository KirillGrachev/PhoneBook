import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ColleaguesModal } from '@/components/ColleaguesModal';
import type { ContactsPage } from '@/services/ContactsService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const searchMock = vi.fn();

// Сервис подменяем целиком: модалка ходит за выдачей только через него.
vi.mock('@/services/ContactsService', () => ({
  getContactsService: () => ({ search: (...args: unknown[]) => searchMock(...args) }),
}));

// Персист конфигурации в тестах не нужен: проверяем модалку, а не мост к Rust.
vi.mock('@/store/configStorage', () => ({
  configStorage: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  flushConfigSave: vi.fn(),
}));

const COLLEAGUES: ContactsPage = {
  total: 3,
  contacts: [
    { id: 'guid-1', fullName: 'Орлова Ольга Павловна', jobTitle: 'Бухгалтер', department: 'Бухгалтерия' },
    { id: 'guid-2', fullName: 'Петров Пётр Петрович', jobTitle: 'Главный бухгалтер', department: 'Бухгалтерия' },
    { id: 'guid-3', fullName: 'Сидорова Мария Алексеевна', jobTitle: 'Бухгалтер', department: 'Бухгалтерия' },
  ],
};

function renderModal() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ColleaguesModal
        isOpen
        onClose={vi.fn()}
        mode="department"
        value="Бухгалтерия"
        organization="ООО «КМАруда»"
        onSelectContact={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('ColleaguesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchMock.mockResolvedValue(COLLEAGUES);
  });

  it('загруженный список сменяет индикатор загрузки, а не подменяет его мгновенно', async () => {
    renderModal();

    // Пока запрос в полёте — индикатор; после ответа прилетают строки.
    expect(screen.getByText('loading')).toBeTruthy();
    expect(await screen.findByText('Орлова Ольга Павловна')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });

  it('поиск внутри списка фильтрует строки без повторного запроса', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText('Орлова Ольга Павловна');

    await user.type(screen.getByRole('textbox', { name: 'searchByDepartment' }), 'главный');

    expect(await screen.findByText('Петров Пётр Петрович')).toBeTruthy();
    expect(screen.queryByText('Орлова Ольга Павловна')).toBeNull();
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('пустая выдача показывает пустое состояние вместо списка', async () => {
    searchMock.mockResolvedValue({ contacts: [], total: 0 });
    renderModal();

    expect(await screen.findByText('noResultsInDept')).toBeTruthy();
    expect(screen.queryByText('loading')).toBeNull();
  });
});
