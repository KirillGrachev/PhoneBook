import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import i18n from '@/lib/i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Boundary изолирует падение поддерева (список/карточка) от всего окна.
 * Ошибки логируются в консоль; пользователь может повторить рендер
 * или перезапустить приложение.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] uncaught error:', error, errorInfo.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: undefined });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = i18n.t.bind(i18n);

    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-[9999] p-4">
        <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8" aria-hidden />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            {i18n.language === 'en' ? 'Something went wrong' : 'Что-то пошло не так'}
          </h2>

          <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
            {i18n.language === 'en'
              ? 'A part of the UI crashed. You can retry rendering or restart the application.'
              : 'Фрагмент интерфейса завершился с ошибкой. Можно повторить отрисовку или перезапустить приложение.'}
            {this.state.error && (
              <span className="block mt-4 text-xs font-mono bg-black/10 dark:bg-white/5 p-2 rounded text-left overflow-x-auto text-foreground/70">
                {this.state.error.message}
              </span>
            )}
          </p>

          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={this.handleReset}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-surface border border-border hover:bg-surface-hover text-foreground rounded-lg font-medium transition-colors flex-1 cursor-pointer"
            >
              {t('retry')}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors flex-1 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" aria-hidden />
              {i18n.language === 'en' ? 'Restart' : 'Перезапустить'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
