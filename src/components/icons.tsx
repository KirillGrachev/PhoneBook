import type { ComponentType, CSSProperties } from 'react';

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

export {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy as Restore,
  Loader2,
  Minus,
  Square,
  X,
} from 'lucide-react';
