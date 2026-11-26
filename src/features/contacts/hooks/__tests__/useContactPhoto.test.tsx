import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useContactPhoto } from '@/features/contacts/hooks/useContactData';
import { useAppStore } from '@/store/useAppStore';

const { getPhoto } = vi.hoisted(() => ({ getPhoto: vi.fn() }));

vi.mock('@/services/ContactsService', () => ({
  getContactsService: () => ({ getPhoto }),
  isMockMode: () => false,
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  getPhoto.mockReset();
  getPhoto.mockResolvedValue('data:image/png;base64,AAA');
  useAppStore.setState({ showAvatars: true, testMode: false });
});

afterEach(() => {
  useAppStore.setState({ showAvatars: true });
});

describe('useContactPhoto', () => {
  it('fetches the photo when avatars are enabled', async () => {
    const { result } = renderHook(() => useContactPhoto('contact-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(getPhoto).toHaveBeenCalledWith('contact-1'));
    await waitFor(() => expect(result.current.data).toBe('data:image/png;base64,AAA'));
  });

  it('does not request the photo when avatars are disabled', () => {
    useAppStore.setState({ showAvatars: false });
    const { result } = renderHook(() => useContactPhoto('contact-1'), { wrapper: makeWrapper() });
    expect(getPhoto).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
