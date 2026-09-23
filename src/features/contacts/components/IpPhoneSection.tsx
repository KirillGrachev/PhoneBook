import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';

interface IpPhoneSectionProps {
  ipPhone?: string;
  fullIpPhone?: string;
}

/** Акцентный блок с номерами IP-телефонии. */
export function IpPhoneSection({ ipPhone, fullIpPhone }: IpPhoneSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full min-w-0 bg-primary text-white rounded-[20px] p-5 sm:p-6 shadow-sm mb-6 sm:mb-8 overflow-hidden relative">
      <div className="absolute -right-4 -top-4 opacity-10 pointer-events-none" aria-hidden>
        <Phone className="w-32 h-32" />
      </div>

      <div className="flex flex-col sm:flex-row relative z-10 w-full justify-stretch items-stretch text-center">
        {ipPhone && (
          <div className="flex-1 flex flex-col gap-1.5 min-w-0 items-center justify-center pb-6 sm:pb-0 sm:px-4 md:px-6 lg:px-8">
            <span className="text-[14px] font-bold text-white/80 uppercase">{t('ipPhone')}</span>
            <div className="inline-flex items-center justify-center gap-2 max-w-full">
              <span
                className="text-[30px] sm:text-[32px] md:text-[36px] lg:text-[42px] font-black leading-tight drop-shadow-sm break-words select-text"
                title={ipPhone}
              >
                {ipPhone}
              </span>
              <CopyButton text={ipPhone} className="shrink-0" />
            </div>
          </div>
        )}

        {fullIpPhone && (
          <div
            className={cn(
              'flex-1 flex flex-col gap-1.5 min-w-0 items-center justify-center pt-6 sm:pt-0 px-2 sm:px-4 md:px-6 lg:px-8',
              ipPhone && 'border-t sm:border-t-0 sm:border-l border-white/20',
            )}
          >
            <span className="text-[14px] font-bold text-white/80 uppercase">{t('fullIpPhone')}</span>
            <div className="inline-flex items-center justify-center gap-2 max-w-full">
              <span
                className={cn(
                  'font-black leading-tight drop-shadow-sm break-words select-text',
                  ipPhone
                    ? 'text-[18px] sm:text-[22px] md:text-[24px] lg:text-[28px]'
                    : 'text-[28px] sm:text-[32px] md:text-[36px] lg:text-[42px]',
                )}
                title={fullIpPhone}
              >
                {fullIpPhone}
              </span>
              <CopyButton text={fullIpPhone} className="shrink-0" />
            </div>
          </div>
        )}

        {!ipPhone && !fullIpPhone && (
          <div className="flex-1 flex flex-col gap-1.5 min-w-0 items-center justify-center">
            <span className="text-[14px] font-bold text-white/80 uppercase">{t('ipPhone')}</span>
            <span
              className="text-[32px] md:text-[36px] lg:text-[42px] font-black leading-tight drop-shadow-sm"
              aria-hidden
            >
              —
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
