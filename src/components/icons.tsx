import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

import { AppIcon, type AppIconName } from './AppIcon';

/**
 * Иконки приложения.
 *
 * Имена совпадают с `lucide-react`, чтобы замена не затрагивала разметку.
 * Для иконок, которых нет в новом наборе (крестики, шевроны, плюсы и т.п.),
 * сохраняются прежние lucide-компоненты.
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

export const ArrowLeftRight = createIcon('arrows');
export const Briefcase = createIcon('id-card');
export const Building2 = createIcon('building');
export const Copy = createIcon('copy');
export const DatabaseZap = createIcon('address-book');
export const Download = createIcon('frame-download');
export const FileDown = createIcon('frame-download');
export const FileStack = createIcon('layers');
export const FileUp = createIcon('frame-upload');
export const Filter = createIcon('filter');
export const FlaskConical = createIcon('rocket');
export const FolderOpen = createIcon('folder-upload');
export const HelpCircle = createIcon('help');
export const Info = createIcon('info');
export const KeyRound = createIcon('shield-lock');
export const Layers = createIcon('layers');
export const Mail = createIcon('mail');
export const MailWarning = createIcon('mail');
export const MapPin = createIcon('map-pin');
export const Monitor = createIcon('monitor');
export const MonitorSmartphone = createIcon('monitor');
export const Moon = createIcon('moon');
export const Network = createIcon('org');
export const Pencil = createIcon('text-scan');
export const Pin = createIcon('map-pin');
export const PlugZap = createIcon('terminal');
export const RefreshCw = createIcon('refresh');
export const Search = createIcon('search');
export const SearchX = createIcon('search');
export const Settings = createIcon('settings');
export const Settings2 = createIcon('settings');
export const ShieldAlert = createIcon('shield-off');
export const Smartphone = createIcon('mobile');
export const Sun = createIcon('sun');
export const Terminal = createIcon('terminal');
export const TextScan = createIcon('text-scan');
export const Trash2 = createIcon('trash');
export const Upload = createIcon('frame-upload');
export const UserRound = createIcon('user');
export const UserPlus = createIcon('user-plus');
export const UsersRound = createIcon('frame-users');

export {
  AlertTriangle,
  ArrowLeft,
  BookmarkCheck,
  BookmarkMinus,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Minus,
  Palette,
  Phone,
  Plus,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
