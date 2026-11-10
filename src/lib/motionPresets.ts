import type { Variants } from 'motion/react';

import { useAppStore } from '@/store/useAppStore';

/**
 * Общие пресеты появления содержимого после загрузки.
 *
 * Единая семья движения для всех поверхностей справочника: списки коллег
 * (модалка отдела / должности / кабинета), основной список результатов и
 * разделы настроек переключаются одинаковым кроссфейдом, а непустые списки
 * дополнительно раскрываются поколенно. Длительности и easing собраны здесь,
 * чтобы «плавно» везде означало одно и то же движение; CSS-тайминги радикс-
 * дропдаунов (`.submenu-pop` в index.css) зеркалят эти же значения.
 *
 * Переключатель «Анимации» обесценивает пресеты через
 * [`useMotionPresets`]: у выключенных пресетов duration/delay/stagger
 * обнулены, потому что собственный `transition` варианта перекрывает
 * `MotionConfig`. Класс `.disable-animations` дополнительно обнуляет
 * CSS-анимации дропдаунов.
 */

/** Кроссфейд блока содержимого: загрузка → список → пустое состояние. */
export const contentRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

/**
 * Контейнер списка: кроссфейд целиком плюс каскад строк.
 *
 * `staggerChildren` касается только монтирования строк (первая загрузка,
 * смена страницы или режима): строки, домонтированные фильтром поиска
 * поверх уже показанного списка, просто занимают свои места без каскада.
 */
export const listRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.2, ease: 'easeOut', delayChildren: 0.04, staggerChildren: 0.035 },
  },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

/** Строка списка: лёгкий подъём с проявлением, без рывка по горизонтали. */
export const listRowRevealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: 'easeIn' } },
};

const instantContentRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const instantListRevealVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0, delayChildren: 0, staggerChildren: 0 },
  },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const instantListRowRevealVariants: Variants = {
  hidden: { opacity: 0, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0 } },
  exit: { opacity: 0, transition: { duration: 0 } },
};

const enabledPresets = {
  content: contentRevealVariants,
  list: listRevealVariants,
  row: listRowRevealVariants,
};

const disabledPresets = {
  content: instantContentRevealVariants,
  list: instantListRevealVariants,
  row: instantListRowRevealVariants,
};

/**
 * Пресеты с учётом глобального тумблера анимаций. Возвращает стабильные
 * объекты, чтобы не пересоздавать variants на каждый рендер.
 */
export function useMotionPresets() {
  const animationsEnabled = useAppStore((state) => state.animationsEnabled);
  return animationsEnabled ? enabledPresets : disabledPresets;
}
