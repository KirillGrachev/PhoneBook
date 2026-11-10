import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '@/features/settings/SettingsPage';

describe('SettingsPage: доступность', () => {
  it('Escape закрывает экран настроек', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <SettingsPage onClose={onClose} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
