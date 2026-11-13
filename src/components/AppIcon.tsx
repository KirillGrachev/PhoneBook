import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import arrowLeft from '@/assets/icons/arrow-left.svg';
import arrowRight from '@/assets/icons/arrow-right.svg';
import building from '@/assets/icons/building.svg';
import chat from '@/assets/icons/chat.svg';
import clearInput from '@/assets/icons/clear-input.svg';
import contact from '@/assets/icons/contact.svg';
import contactRemove from '@/assets/icons/contact-remove.svg';
import copy from '@/assets/icons/copy.svg';
import department from '@/assets/icons/department.svg';
import edit from '@/assets/icons/edit.svg';
import exportIcon from '@/assets/icons/export.svg';
import filter from '@/assets/icons/filter.svg';
import folderUpload from '@/assets/icons/folder-upload.svg';
import groups from '@/assets/icons/groups.svg';
import help from '@/assets/icons/help.svg';
import importIcon from '@/assets/icons/import.svg';
import jobTitle from '@/assets/icons/job-title.svg';
import lock from '@/assets/icons/lock.svg';
import mail from '@/assets/icons/mail.svg';
import main from '@/assets/icons/main.svg';
import manager from '@/assets/icons/manager.svg';
import monitor from '@/assets/icons/monitor.svg';
import moon from '@/assets/icons/moon.svg';
import office from '@/assets/icons/office.svg';
import phone from '@/assets/icons/phone.svg';
import plus from '@/assets/icons/plus.svg';
import qrCode from '@/assets/icons/qr-code.svg';
import refresh from '@/assets/icons/refresh.svg';
import search from '@/assets/icons/search.svg';
import settings from '@/assets/icons/settings.svg';
import shieldAlert from '@/assets/icons/shield-alert.svg';
import sun from '@/assets/icons/sun.svg';
import terminal from '@/assets/icons/terminal.svg';
import trash from '@/assets/icons/trash.svg';

export type AppIconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'building'
  | 'chat'
  | 'clear-input'
  | 'contact'
  | 'contact-remove'
  | 'copy'
  | 'department'
  | 'edit'
  | 'export'
  | 'filter'
  | 'folder-upload'
  | 'groups'
  | 'help'
  | 'import'
  | 'job-title'
  | 'lock'
  | 'mail'
  | 'main'
  | 'manager'
  | 'monitor'
  | 'moon'
  | 'office'
  | 'phone'
  | 'plus'
  | 'qr-code'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'shield-alert'
  | 'sun'
  | 'terminal'
  | 'trash';

const ICONS: Record<AppIconName, string> = {
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  building,
  chat,
  'clear-input': clearInput,
  contact,
  'contact-remove': contactRemove,
  copy,
  department,
  edit,
  export: exportIcon,
  filter,
  'folder-upload': folderUpload,
  groups,
  help,
  import: importIcon,
  'job-title': jobTitle,
  lock,
  mail,
  main,
  manager,
  monitor,
  moon,
  office,
  phone,
  plus,
  'qr-code': qrCode,
  refresh,
  search,
  settings,
  'shield-alert': shieldAlert,
  sun,
  terminal,
  trash,
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
