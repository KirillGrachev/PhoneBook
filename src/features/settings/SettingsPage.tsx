import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { contentRevealVariants } from '@/lib/motionPresets';

import { SettingsAboutView } from './components/SettingsAboutView';
import { SettingsAdView } from './components/SettingsAdView';
import { SettingsExternalView } from './components/SettingsExternalView';
import { SettingsGroupsView } from './components/SettingsGroupsView';
import { SettingsHeader } from './components/SettingsHeader';
import { SettingsInterfaceView } from './components/SettingsInterfaceView';
import { SettingsMainView } from './components/SettingsMainView';
import { SettingsTransferView } from './components/SettingsTransferView';

/**
 * Экраны настроек: главный (навигация), интерфейс и поиск, внешний телефонный
 * файл, перенос конфигурации, о программе, AD, группы организаций.
 */
export type SettingsView = 'main' | 'interface' | 'external' | 'transfer' | 'about' | 'ad' | 'groups';

/** Ключи перевода заголовков шапки для каждого экрана. */
const VIEW_TITLE_KEYS: Record<SettingsView, string> = {
  main: 'settings',
  interface: 'settings.interfaceTitle',
  external: 'settings.externalTitle',
  transfer: 'settings.transferTitle',
  about: 'aboutTitle',
  ad: 'settings.adSettings',
  groups: 'settings.orgGroups',
};

interface SettingsPageProps {
  onClose: () => void;
}

function parseView(raw: string | null): SettingsView {
  if (raw === 'interface') return 'interface';
  if (raw === 'external') return 'external';
  if (raw === 'transfer') return 'transfer';
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
 * и корректное поведение кнопки «назад». Главный раздел — список переходов:
 * группы настроек разнесены по отдельным экранам, чтобы не собирать все
 * органы управления на одной прокручиваемой странице.
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
          <SettingsHeader title={t(VIEW_TITLE_KEYS[view])} onBack={view === 'main' ? onClose : () => setView('main')} />
          {/* Переход между разделами — кроссфейд из общих пресетов:
              навигация хаба и возвраты не подменяют содержимое рывком. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              variants={contentRevealVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="flex flex-col"
            >
              {view === 'main' && <SettingsMainView onNavigate={setView} />}
              {view === 'interface' && <SettingsInterfaceView />}
              {/* Внешний телефонный файл — функция десктоп-сборки: в браузере
                  раздела нет ни в навигации, ни по прямой ссылке. */}
              {view === 'external' && isTauri() && <SettingsExternalView />}
              {view === 'transfer' && <SettingsTransferView />}
              {view === 'about' && <SettingsAboutView />}
              {view === 'ad' && <SettingsAdView />}
              {view === 'groups' && <SettingsGroupsView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
