import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import addressBook from '@/assets/icons/address-book.svg';
import arrows from '@/assets/icons/arrows.svg';
import building from '@/assets/icons/building.svg';
import certificate from '@/assets/icons/certificate.svg';
import copy from '@/assets/icons/copy.svg';
import filePhone from '@/assets/icons/file-phone.svg';
import filter from '@/assets/icons/filter.svg';
import folderUpload from '@/assets/icons/folder-upload.svg';
import frameDownload from '@/assets/icons/frame-download.svg';
import frameUpload from '@/assets/icons/frame-upload.svg';
import frameUsers from '@/assets/icons/frame-users.svg';
import help from '@/assets/icons/help.svg';
import idCard from '@/assets/icons/id-card.svg';
import info from '@/assets/icons/info.svg';
import layers from '@/assets/icons/layers.svg';
import mail from '@/assets/icons/mail.svg';
import mapPin from '@/assets/icons/map-pin.svg';
import mobile from '@/assets/icons/mobile.svg';
import monitor from '@/assets/icons/monitor.svg';
import moon from '@/assets/icons/moon.svg';
import org from '@/assets/icons/org.svg';
import refresh from '@/assets/icons/refresh.svg';
import rocket from '@/assets/icons/rocket.svg';
import search from '@/assets/icons/search.svg';
import settings from '@/assets/icons/settings.svg';
import shieldLock from '@/assets/icons/shield-lock.svg';
import shieldOff from '@/assets/icons/shield-off.svg';
import sun from '@/assets/icons/sun.svg';
import terminal from '@/assets/icons/terminal.svg';
import textScan from '@/assets/icons/text-scan.svg';
import trash from '@/assets/icons/trash.svg';
import user from '@/assets/icons/user.svg';
import userPlus from '@/assets/icons/user-plus.svg';

export type AppIconName =
  | 'address-book'
  | 'arrows'
  | 'building'
  | 'certificate'
  | 'copy'
  | 'file-phone'
  | 'filter'
  | 'folder-upload'
  | 'frame-download'
  | 'frame-upload'
  | 'frame-users'
  | 'help'
  | 'id-card'
  | 'info'
  | 'layers'
  | 'mail'
  | 'map-pin'
  | 'mobile'
  | 'monitor'
  | 'moon'
  | 'org'
  | 'refresh'
  | 'rocket'
  | 'search'
  | 'settings'
  | 'shield-lock'
  | 'shield-off'
  | 'sun'
  | 'terminal'
  | 'text-scan'
  | 'trash'
  | 'user'
  | 'user-plus';

const ICONS: Record<AppIconName, string> = {
  'address-book': addressBook,
  arrows,
  building,
  certificate,
  copy,
  'file-phone': filePhone,
  filter,
  'folder-upload': folderUpload,
  'frame-download': frameDownload,
  'frame-upload': frameUpload,
  'frame-users': frameUsers,
  help,
  'id-card': idCard,
  info,
  layers,
  mail,
  'map-pin': mapPin,
  mobile,
  monitor,
  moon,
  org,
  refresh,
  rocket,
  search,
  settings,
  'shield-lock': shieldLock,
  'shield-off': shieldOff,
  sun,
  terminal,
  'text-scan': textScan,
  trash,
  user,
  'user-plus': userPlus,
};

interface AppIconProps {
  name: AppIconName;
  className?: string;
  label?: string;
  size?: number | string;
}

/** Иконка из нового набора: цвет наследуется от текста через currentColor. */
export function AppIcon({ name, className, label, size }: AppIconProps) {
  const style = {
    WebkitMaskImage: `url("${ICONS[name]}")`,
    maskImage: `url("${ICONS[name]}")`,
    ...(size === undefined
      ? {}
      : {
          width: typeof size === 'number' ? `${size}px` : size,
          height: typeof size === 'number' ? `${size}px` : size,
        }),
  } as CSSProperties;

  return (
    <span
      className={cn('app-icon shrink-0', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
