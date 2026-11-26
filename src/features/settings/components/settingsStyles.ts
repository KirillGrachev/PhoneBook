/** Shared layout classes of settings sections. */

/** A navigation row in the settings navigation lists. */
export const NAV_ITEM_CLASS =
  'group w-full flex items-center justify-between border border-border bg-surface hover:bg-surface-hover outline-none px-4 py-4 rounded-[16px] transition-all duration-300 shadow-sm cursor-pointer';

/** An action button inside a settings card (export, file load, etc.). */
export const ACTION_BUTTON_CLASS =
  'inline-flex items-center gap-2 px-3.5 py-2 rounded-[12px] text-[13px] font-semibold outline-none transition-colors cursor-pointer border border-border bg-surface text-foreground hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed';

/** Settings group title (upper case, muted color). */
export const SECTION_HEADING_CLASS = 'text-[13px] font-bold text-muted-foreground pl-1 uppercase';

/** A row card with a toggle: text on the left, switch on the right. */
export const SWITCH_ROW_CLASS =
  'flex items-center justify-between border border-border bg-surface p-3.5 rounded-[16px] shadow-sm';
