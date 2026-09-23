import { useTranslation } from 'react-i18next';
import { cva } from 'class-variance-authority';

import type { TabType } from '@/types';

const tabVariants = cva(
  'flex-1 h-full flex items-center justify-center text-[15px] font-medium px-4 rounded-[10px] transition-all duration-300 ease-in-out outline-none mx-0.5 min-w-0 cursor-pointer',
  {
    variants: {
      active: {
        true: 'bg-white text-black shadow-[0_2px_8px_rgba(0,0,0,0.12)] dark:bg-zinc-700 dark:text-white',
        false:
          'text-foreground/80 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/10 dark:active:bg-white/20',
      },
    },
    defaultVariants: { active: false },
  },
);

interface TabSelectorProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  globalMode?: boolean;
}

const TAB_ORDER: TabType[] = ['kmaruda', 'global', 'local'];

/** Переключатель вкладок: предприятие / холдинг / мои контакты. */
export function TabSelector({ activeTab, onTabChange, globalMode }: TabSelectorProps) {
  const { t } = useTranslation();

  const labels: Record<TabType, string> = {
    kmaruda: t('kmarudaTab'),
    global: t('holding'),
    local: t('myContacts'),
  };

  const visibleTabs = TAB_ORDER.filter((tab) => !(tab === 'kmaruda' && globalMode));

  return (
    <div className="flex w-full bg-input p-1.5 rounded-[16px] h-[52px]" role="tablist" aria-label={t('directory')}>
      {visibleTabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={activeTab === tab}
          aria-label={labels[tab]}
          tabIndex={activeTab === tab ? 0 : -1}
          className={tabVariants({ active: activeTab === tab })}
          onClick={() => onTabChange(tab)}
          onKeyDown={(event) => {
            // Стрелки переключают вкладки (паттерн WAI-ARIA tabs).
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
              return;
            }
            event.preventDefault();
            const delta = event.key === 'ArrowRight' ? 1 : -1;
            const index = visibleTabs.indexOf(tab);
            const next = visibleTabs[(index + delta + visibleTabs.length) % visibleTabs.length];
            onTabChange(next);
            document.getElementById(`tab-${next}`)?.focus();
          }}
        >
          <span className="truncate">{labels[tab]}</span>
        </button>
      ))}
    </div>
  );
}
