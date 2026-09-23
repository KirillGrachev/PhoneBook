import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ApiError } from '@/api/backend';
import i18n from '@/lib/i18n';
import { useAppStore } from '@/store/useAppStore';

import '@/index.css';

// Язык из сохранённой конфигурации — ещё до первого рендера.
void i18n.changeLanguage(useAppStore.getState().language);

// Axe-core: аудит доступности только в dev.
if (import.meta.env.DEV) {
  void Promise.all([import('@axe-core/react'), import('react'), import('react-dom')]).then(([axe, React, ReactDOM]) => {
    axe.default(React.default ?? React, ReactDOM, 1000);
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      /**
       * Ошибки бэкенда детерминированы (конфигурация/доступность AD) —
       * автоматические повторы только мешают; неизвестные ошибки ретраим.
       */
      retry: (failureCount, error) => (error instanceof ApiError ? false : failureCount < 2),
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
