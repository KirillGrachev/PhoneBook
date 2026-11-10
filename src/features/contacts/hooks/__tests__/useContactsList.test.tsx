import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useContactsList } from '@/features/contacts/hooks/useContactsList';
import { MockContactsService } from '@/services/MockContactsService';
import { useAppStore } from '@/store/useAppStore';

const service = new MockContactsService();

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  useAppStore.setState({ testMode: false });
});

describe('useContactsList: локальный поиск и пагинация', () => {
  it('фильтрует избранное по строке и отдаёт точный total', async () => {
    useAppStore.setState({ testMode: true });
    const all = await service.search({ activeTab: 'global' });
    const saved = all.contacts.slice(0, 5);
    const savedIds = saved.map((contact) => contact.id);
    const token = saved[0].fullName.split(/\s+/)[0];

    const { result } = renderHook(() => useContactsList('local', token, null, savedIds, null), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 });
    expect(result.current.total).toBeGreaterThan(0);
    expect(result.current.total).toBe(result.current.contacts.length);
    expect(result.current.contacts.every((contact) => savedIds.includes(contact.id))).toBe(true);
  });
});
