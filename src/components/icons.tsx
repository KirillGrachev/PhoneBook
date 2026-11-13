import type { ComponentType, CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { AppIcon, type AppIconName } from './AppIcon';

/**
 * Иконки приложения.
 *
 * Имена совпадают с прежними экспортами, чтобы замена не затрагивала разметку.
 * Готовые иконки из нового набора идут через `AppIcon`; для иконок, которых
 * в наборе пока нет, временно используется эмодзи-заглушка.
 */
export interface AppIconProps {
  className?: string;
  size?: number | string;
  'aria-hidden'?: boolean;
  'aria-label'?: string;
  title?: string;
  strokeWidth?: number | string;
}

export type IconComponent = ComponentType<AppIconProps>;

function createIcon(name: AppIconName, baseClassName?: string): IconComponent {
  return function Icon({ className, size, 'aria-label': ariaLabel }: AppIconProps) {
    return <AppIcon name={name} size={size} label={ariaLabel} className={cn(baseClassName, className)} />;
  };
}

/** Управляющие иконки (крестик, галочка, шевроны, спиннер) — без Lucide. */
function createStrokeIcon(children: ReactNode): IconComponent {
  return function StrokeIcon({ className, size, 'aria-label': ariaLabel, strokeWidth = 2 }: AppIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('shrink-0', className)}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
      >
        {children}
      </svg>
    );
  };
}

/**
 * Размер эмодзи берём из тех же `w-*`/`h-*` классов, что передают вызывающие
 * компоненты: эмодзи рисуется шрифтом, поэтому ему нужен `font-size`, а не
 * только ширина/высота контейнера.
 */
function dimensionFromClassName(className?: string): string | undefined {
  if (!className) {
    return undefined;
  }

  const arbitrary = className.match(/(?:^|\s)[wh]-\[(\d+(?:\.\d+)?)px\]/);
  if (arbitrary) {
    return `${arbitrary[1]}px`;
  }

  const scale = className.match(/(?:^|\s)[wh]-(\d+(?:\.\d+)?)(?=\s|$)/);
  if (scale) {
    return `${Number(scale[1]) * 4}px`;
  }

  return undefined;
}

function createEmoji(glyph: string, baseClassName?: string): IconComponent {
  return function Emoji({ className, size, 'aria-label': ariaLabel }: AppIconProps) {
    const dimension =
      typeof size === 'number' ? `${size}px` : typeof size === 'string' ? size : dimensionFromClassName(className);
    const style: CSSProperties | undefined = dimension
      ? { width: dimension, height: dimension, fontSize: dimension }
      : undefined;

    return (
      <span
        className={cn('app-emoji', baseClassName, className)}
        style={style}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
      >
        {glyph}
      </span>
    );
  };
}

// Новый набор иконок.
export const ArrowLeft = createIcon('arrow-left');
export const ArrowRight = createIcon('arrow-right');
export const BookmarkCheck = createIcon('contact');
export const BookmarkMinus = createIcon('contact-remove');
export const Briefcase = createIcon('job-title');
export const Building2 = createIcon('building');
export const ClearInput = createIcon('clear-input');
export const Copy = createIcon('copy');
export const Edit = createIcon('edit');
export const Export = createIcon('export');
export const Filter = createIcon('filter');
export const FolderUpload = createIcon('folder-upload');
export const Groups = createIcon('groups');
export const HelpCircle = createIcon('help');
export const Import = createIcon('import');
export const Lock = createIcon('lock');
export const Mail = createIcon('mail');
export const MailWarning = createIcon('mail');
export const Main = createIcon('main');
export const MapPin = createIcon('office');
export const MessageCircle = createIcon('chat');
export const Monitor = createIcon('monitor');
export const Moon = createIcon('moon');
export const Network = createIcon('department');
export const Phone = createIcon('phone');
export const Plus = createIcon('plus');
export const QrCode = createIcon('qr-code');
export const Refresh = createIcon('refresh');
export const Search = createIcon('search');
export const Settings = createIcon('settings');
export const Settings2 = createIcon('settings');
export const ShieldAlert = createIcon('shield-alert');
export const Sun = createIcon('sun');
export const Terminal = createIcon('terminal');
export const Trash = createIcon('trash');
export const UserRound = createIcon('manager');

// Временные эмодзи-заглушки для иконок, которых ещё нет в наборе.
export const AlertTriangle = createEmoji('⚠️');
export const Layers = createEmoji('🗂️');
export const Pin = createEmoji('📌');
export const SearchX = createEmoji('🔎');

export const Check = createStrokeIcon(<polyline points="20 6 9 17 4 12" />);
export const ChevronDown = createStrokeIcon(<polyline points="6 9 12 15 18 9" />);
export const ChevronLeft = createStrokeIcon(<polyline points="15 18 9 12 15 6" />);
export const ChevronRight = createStrokeIcon(<polyline points="9 18 15 12 9 6" />);
export const Loader2 = createStrokeIcon(<path d="M21 12a9 9 0 1 1-6.219-8.56" />);
export const Minus = createStrokeIcon(<line x1="5" y1="12" x2="19" y2="12" />);
export const Restore = createIcon('copy');
export const Square = createStrokeIcon(<rect x="3" y="3" width="18" height="18" rx="2" />);
export const X = createStrokeIcon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
