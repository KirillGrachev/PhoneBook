import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

interface AvatarProps {
  fullName: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * Optional photo (a `data:` URL from the AD `thumbnailPhoto` attribute).
   * When absent or failed to load, a letter initial on a gradient is shown.
   */
  photoUrl?: string | null;
}

const SIZE_STYLES = {
  sm: 'w-[40px] h-[40px] text-[16px]',
  md: 'w-[64px] h-[64px] sm:w-[72px] sm:h-[72px] text-[24px] sm:text-[28px]',
  lg: 'w-[96px] h-[96px] text-[36px]',
} as const;

/**
 * Contact avatar: the AD photo when available and avatars are enabled,
 * otherwise a letter initial.
 *
 * The photo is fetched lazily for the open card only (see `useContactPhoto`),
 * so list rows stay lightweight and uniform. A broken or missing image falls
 * back to the initial, which reads the same for every record. The user can
 * disable photos entirely in interface settings; the letter fallback is then
 * used for every contact.
 */
export function Avatar({ fullName, size = 'md', className, photoUrl }: AvatarProps) {
  const showAvatars = useAppStore((state) => state.showAvatars);
  const initial = fullName.trim().charAt(0).toUpperCase() || '?';
  const [failed, setFailed] = useState(false);

  // Reset the error flag when the photo changes (e.g. navigating between cards).
  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  const showPhoto = showAvatars && Boolean(photoUrl) && !failed;

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
      {showPhoto ? (
        <img
          src={photoUrl ?? undefined}
          alt=""
          aria-hidden
          draggable={false}
          onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </div>
  );
}
