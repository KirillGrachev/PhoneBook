import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FocusLock from '@/components/ui/FocusLock';
import { useTranslation } from 'react-i18next';

import { isTauri } from '@/api/backend';
import { useAppStore } from '@/store/useAppStore';

import { SettingsAboutView } from './components/SettingsAboutView';
import { SettingsAdView } from './components/SettingsAdView';
import { SettingsExternalView } from './components/SettingsExternalView';
import { SettingsGroupsView } from './components/SettingsGroupsView';
import { SettingsHeader } from './components/SettingsHeader';
import { SettingsInterfaceView } from './components/SettingsInterfaceView';
import { SettingsMainView } from './components/SettingsMainView';
import { SettingsTransferView } from './components/SettingsTransferView';

/**
 * Settings screens: main (navigation), interface and search, external phone
 * file, config transfer, about, AD, organization groups.
 */
export type SettingsView = 'main' | 'interface' | 'external' | 'transfer' | 'about' | 'ad' | 'groups';

/** Translation keys of the header titles for each screen. */
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
 * The settings page.
 *
 * The current section lives in a query parameter (`/settings?view=ad`) — this gives
 * deep links from other screens (empty directory, sync chip)
 * and correct "back" button behavior. The main section is a list of links:
 * settings groups are spread across separate screens so as not to gather all
 * controls on a single scrollable page.
 */
export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const managed = useAppStore((state) => state.managed);
  const managedProfile = useAppStore((state) => state.managedProfile);
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setViewState] = useState<SettingsView>(() => parseView(searchParams.get('view')));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  // In an embedded/managed profile administrative sections are not shown at all:
  // only "Interface and search" and "About" remain. Direct links
  // (?view=ad etc.) return to the main settings screen.
  useEffect(() => {
    if (!managed) {
      return;
    }
    if (view === 'external' || view === 'transfer' || view === 'ad' || view === 'groups') {
      setView('main');
    }
  }, [managed, view, setView]);

  return (
    // The settings screen opens instantly: without its own animation
    // appearance/closing. The general "Animations" toggle still controls
    // the other surfaces of the application.
    <FocusLock returnFocus={{ preventScroll: true }} focusOptions={{ preventScroll: true }}>
      <div
        className="absolute top-[32px] bottom-0 left-0 right-0 z-50 bg-background flex flex-col w-full text-foreground"
        role="dialog"
        aria-modal="true"
      >
        {/* The scroll container itself is a flex column: inner auto fields
          (my-auto) center the settings block vertically while it is shorter
          than the screen, and collapse to zero on overflow - scrolling starts
          from the top without clipping the header (unlike justify-center). */}
        <div className="flex-1 overflow-y-auto w-full relative flex flex-col [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="shrink-0 my-auto py-8 px-6 xl:px-12 mx-auto max-w-[600px] w-full flex flex-col">
            <SettingsHeader
              title={t(VIEW_TITLE_KEYS[view])}
              onBack={view === 'main' ? onClose : () => setView('main')}
            />
            {managed && view !== 'about' && (
              <div
                role="status"
                className="mb-4 rounded-[12px] border border-primary/25 bg-primary/10 px-4 py-3 text-[13px] leading-snug text-foreground"
              >
                <span className="font-bold">{t('managed.bannerTitle')}</span>{' '}
                {t('managed.bannerDesc', { profile: managedProfile ?? t('managed.defaultProfile') })}
              </div>
            )}
            {/* The section switches instantly, without animation: the settings screen
              must not "rise" or flicker during navigation. */}
            <div className="flex flex-col">
              {view === 'main' && <SettingsMainView onNavigate={setView} />}
              {view === 'interface' && <SettingsInterfaceView />}
              {/* The external phone file is a desktop build feature: in the browser
                the section is absent from both navigation and direct links. */}
              {view === 'external' && isTauri() && (
                <fieldset
                  disabled={managed}
                  className={`min-w-0 border-0 p-0 m-0 disabled:opacity-60 ${managed ? 'pointer-events-none' : ''}`}
                >
                  <SettingsExternalView />
                </fieldset>
              )}
              {view === 'transfer' && <SettingsTransferView />}
              {view === 'about' && <SettingsAboutView />}
              {view === 'ad' && (
                <fieldset
                  disabled={managed}
                  className={`min-w-0 border-0 p-0 m-0 disabled:opacity-60 ${managed ? 'pointer-events-none' : ''}`}
                >
                  <SettingsAdView />
                </fieldset>
              )}
              {view === 'groups' && (
                <fieldset
                  disabled={managed}
                  className={`min-w-0 border-0 p-0 m-0 disabled:opacity-60 ${managed ? 'pointer-events-none' : ''}`}
                >
                  <SettingsGroupsView />
                </fieldset>
              )}
            </div>
          </div>
        </div>
      </div>
    </FocusLock>
  );
}
