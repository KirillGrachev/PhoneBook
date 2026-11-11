import { lazy, Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Toaster } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Loader2 } from '@/components/icons';

import { isTauri } from '@/api/backend';
import { TitleBar } from '@/components/TitleBar';
import { SplashScreen } from '@/components/SplashScreen';
import { PhonebookView } from '@/features/contacts/PhonebookView';

const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
import { useContactCount } from '@/hooks/useDirectory';
import { useDesktopEnvironment } from '@/hooks/useDesktopEnvironment';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useThemeApplier } from '@/hooks/useThemeApplier';
import i18n from '@/lib/i18n';
import { flushConfigSave } from '@/store/configStorage';
import { useAppStore } from '@/store/useAppStore';

/** Корневой компонент: провайдеры, гидрация, splash и роутинг. */
export default function App() {
  useDesktopEnvironment();

  const location = useLocation();
  const navigate = useNavigate();

  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);

  const [isHydrated, setIsHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  useThemeApplier(theme);

  // Язык документа для скринридеров и правил переносов следует за UI.
  useEffect(() => {
    document.documentElement.lang = language || 'en';
  }, [language]);

  // Закрытие окна: сначала дожидаемся debounce-сохранения конфигурации,
  // иначе последний переключённый тумблер мог потеряться.
  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void window
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await flushConfigSave();
        await window.destroy();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // Отключаем CSS/Motion-анимации глобально, если пользователь их выключил.
  useEffect(() => {
    document.body.classList.toggle('disable-animations', !animationsEnabled);
  }, [animationsEnabled]);

  // Гидрация persisted-стора (в десктопе — чтение config.json через IPC).
  useEffect(() => {
    const persist = useAppStore.persist;
    if (persist.hasHydrated()) {
      setIsHydrated(true);
    }
    const unsubscribe = persist.onFinishHydration(() => setIsHydrated(true));
    persist.rehydrate();
    return unsubscribe;
  }, []);

  // Язык интерфейса следует за сохранённой настройкой (после гидрации и при изменениях).
  useEffect(() => {
    if (isHydrated && language) {
      void i18n.changeLanguage(language);
    }
  }, [isHydrated, language]);

  // Splash показываем минимум до гидрации + короткий fade.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const timer = setTimeout(() => setShowSplash(false), 500);
    return () => clearTimeout(timer);
  }, [isHydrated]);

  return (
    // reducedMotion привязан к переключателю приложения, а не к ОС
    // («user» обесценивал тумблер: при системном «отключить анимации»
    // он не влиял ни на что): явный выбор пользователя важнее системного.
    <MotionConfig
      transition={animationsEnabled ? undefined : { duration: 0 }}
      reducedMotion={animationsEnabled ? 'user' : 'always'}
    >
      <AnimatePresence mode="wait">
        {showSplash ? (
          <SplashScreen key="splash" />
        ) : (
          <motion.div
            key="app"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={animationsEnabled ? { duration: 0.3, ease: 'easeInOut' } : { duration: 0 }}
            className="flex flex-col h-[100dvh] w-full bg-background text-foreground overflow-hidden font-sans cursor-default transition-colors duration-300 ease-in-out relative select-none"
          >
            <FirstRunOverlay />

            <header role="banner">
              <TitleBar title="KMAruda PhoneBook" />
            </header>

            <main className="flex-1 overflow-hidden relative flex flex-col min-h-0">
              <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground" />}>
                <Routes location={location}>
                  <Route path="/" element={<PhonebookView />} />
                  <Route path="/settings" element={<SettingsPage onClose={() => navigate('/')} />} />
                  <Route path="*" element={<PhonebookView />} />
                </Routes>
              </Suspense>

              <Toaster
                position="bottom-right"
                theme={theme === 'system' ? 'system' : (theme as 'light' | 'dark')}
                duration={4000}
                closeButton
                richColors
                visibleToasts={3}
                expand={false}
                toastOptions={{
                  className:
                    'border border-border shadow-2xl rounded-lg bg-surface text-foreground text-[0.85rem] font-bold p-4 z-[99999]',
                  style: { fontFamily: 'inherit' },
                }}
              />
            </main>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/**
 * Полноэкранный прогресс только для ПЕРВОЙ синхронизации (кэш пуст).
 * Фоновые синхронизации не блокируют работу: поиск идёт по локальной базе,
 * а статус виден в чипе шапки (SyncStatusChip).
 */
function FirstRunOverlay() {
  const { t } = useTranslation();
  const testMode = useAppStore((state) => state.testMode);
  const { running, fetched } = useSyncStatus();
  const { data: contactCount } = useContactCount();

  const isFirstRunSync = isTauri() && !testMode && running && (contactCount ?? 0) === 0;
  if (!isFirstRunSync) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-[9999] bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center text-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" aria-hidden />
      <div className="text-lg font-semibold">{t('sync.firstRun')}</div>
      <div className="text-sm text-muted-foreground mt-2 max-w-[420px] text-center px-6 leading-relaxed">
        {t('sync.firstRunHint')}
      </div>
      {fetched > 0 && (
        <div className="text-sm text-primary font-bold mt-4">{t('sync.progress', { count: fetched })}</div>
      )}
    </div>
  );
}
