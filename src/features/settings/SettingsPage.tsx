import { useState } from 'react';
import { motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { SettingsAboutView } from './components/SettingsAboutView';
import { SettingsHeader } from './components/SettingsHeader';
import { SettingsAdView } from './components/SettingsAdView';
import { SettingsGroupsView } from './components/SettingsGroupsView';
import { SettingsMainView } from './components/SettingsMainView';

/** Экраны настроек: основной, о программе, AD, группы организаций. */
export type SettingsView = 'main' | 'about' | 'ad' | 'groups';

interface SettingsPageProps {
  onClose: () => void;
}

function parseView(raw: string | null): SettingsView {
  if (raw === 'about') return 'about';
  if (raw === 'ad') return 'ad';
  if (raw === 'groups') return 'groups';
  return 'main';
}

/**
 * Страница настроек.
 *
 * Текущий раздел живёт в query-параметре (`/settings?view=ad`) — это даёт
 * глубокие ссылки из других экранов (пустой справочник, чип синхронизации)
 * и корректное поведение кнопки «назад».
 */
export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setViewState] = useState<SettingsView>(() => parseView(searchParams.get('view')));

  const setView = (next: SettingsView) => {
    setViewState(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'main') {
      params.delete('view');
    } else {
      params.set('view', next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-[32px] bottom-0 left-0 right-0 z-50 bg-background flex flex-col w-full text-foreground"
      role="dialog"
      aria-modal="true"
    >
      {/* Скролл-контейнер сам является flex-колонкой: внутренние авто-поля
          (my-auto) центрируют блок настроек по вертикали, пока он короче
          экрана, а при переполнении схлопываются до нуля — скролл начинается
          от верха без обрезки шапки (в отличие от justify-center). */}
      <div className="flex-1 overflow-y-auto w-full relative flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="shrink-0 my-auto py-8 px-6 xl:px-12 mx-auto max-w-[600px] w-full flex flex-col">
          <SettingsHeader
            title={
              view === 'about'
                ? t('aboutTitle')
                : view === 'ad'
                  ? t('settings.adSettings')
                  : view === 'groups'
                    ? t('settings.orgGroups')
                    : t('settings')
            }
            onBack={view === 'main' ? onClose : () => setView('main')}
          />
          {view === 'main' && <SettingsMainView onNavigate={setView} />}
          {view === 'about' && <SettingsAboutView />}
          {view === 'ad' && <SettingsAdView />}
          {view === 'groups' && <SettingsGroupsView />}
        </div>
      </div>
    </motion.div>
  );
}
