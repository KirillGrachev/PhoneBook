import { motion } from 'motion/react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Splash-экран: показывается, пока zustand-persist не гидратирован
 * (в десктопе — до ответа команды `load_config`).
 */
export function SplashScreen() {
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);

  return (
    <motion.main
      exit={animationsEnabled ? { opacity: 0, transition: { duration: 0.25 } } : { opacity: 0 }}
      className="flex flex-col items-center justify-center h-[100dvh] w-full bg-background text-foreground overflow-hidden font-sans relative"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center z-10">
        <img src="/logo.png" alt="" className="w-16 h-16 mb-4 rounded-[14px] shadow-lg" draggable={false} />
        <h1 className="text-[28px] font-black tracking-tight text-foreground mb-1 text-center leading-tight">
          Телефонный
          <br />
          Справочник
        </h1>

        <div className="flex flex-col items-center gap-3 mt-8">
          <div
            className="w-5 h-5 border-[2.5px] border-primary/20 border-t-primary rounded-full animate-spin"
            role="progressbar"
            aria-label="Загрузка приложения"
          />
          <span className="text-[12px] font-semibold tracking-normal text-muted-foreground uppercase">Загрузка</span>
        </div>
      </div>
    </motion.main>
  );
}
