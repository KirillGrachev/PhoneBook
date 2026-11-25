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

  it('does not load the whole directory without a query or filter', async () => {
    useAppStore.setState({ testMode: true });
    const { result } = renderHook(() => useContactsList('global', '', null, [], null), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 3000 });
    expect(result.current.contacts).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.isSearchPending).toBe(false);
  });

  it('flags the search as pending until the current input settles', async () => {
    useAppStore.setState({ testMode: true });
    const { result, rerender } = renderHook(({ search }) => useContactsList('global', search, null, [], null), {
      wrapper: makeWrapper(),
      initialProps: { search: '' },
    });

    // A fresh term is pending immediately: the debounce has not fired yet, so
    // the UI must keep the "Start searching" hint rather than flash "No matches".
    rerender({ search: 'Иванов' });
    expect(result.current.isSearchPending).toBe(true);

    // Once the query for the term settles, pending clears regardless of result.
    await waitFor(() => expect(result.current.isSearchPending).toBe(false), { timeout: 3000 });
    expect(result.current.isLoading).toBe(false);
  });
});
