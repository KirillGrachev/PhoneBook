import { cn } from '@/lib/utils';

interface AvatarProps {
  fullName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_STYLES = {
  sm: 'w-[40px] h-[40px] text-[16px]',
  md: 'w-[64px] h-[64px] sm:w-[72px] sm:h-[72px] text-[24px] sm:text-[28px]',
  lg: 'w-[96px] h-[96px] text-[36px]',
} as const;

/**
 * Буквенный аватар контакта: инициал на градиенте.
 *
 * Фотографии из AD (`thumbnailPhoto`) сознательно не используются: атрибут
 * есть далеко не у всех сотрудников, раздувает кэш и даёт неоднородный вид
 * списка, тогда как инициалы одинаково читаемы для любой записи.
 */
export function Avatar({ fullName, size = 'md', className }: AvatarProps) {
  const initial = fullName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      role="img"
      aria-label={fullName}
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shrink-0 overflow-hidden relative select-none',
        'bg-linear-to-tr from-[#2979FF] to-[#609BFF] text-white',
        SIZE_STYLES[size],
        className,
      )}
    >
      <span aria-hidden>{initial}</span>
    </div>
  );
}
