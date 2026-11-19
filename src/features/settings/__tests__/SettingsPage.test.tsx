import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { SettingsPage } from '@/features/settings/SettingsPage';
import { useAppStore } from '@/store/useAppStore';

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

  it('shows the managed profile banner', () => {
    useAppStore.setState({ managed: true, managedProfile: 'KMAruda', managedRevision: 3 });
    render(
      <MemoryRouter>
        <SettingsPage onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status').textContent).toContain('Managed by your organization');
    expect(screen.getByRole('status').textContent).toContain('KMAruda');
    useAppStore.setState({ managed: false, managedProfile: null, managedRevision: null });
  });
});
