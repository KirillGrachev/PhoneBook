import { useTranslation } from 'react-i18next';

import { Check, X } from '@/components/icons';
import { cn } from '@/lib/utils';

const ORG_ROW_CLASS =
  'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[12px] text-[13px] text-left outline-none transition-colors cursor-pointer border border-transparent hover:bg-surface-hover focus-visible:border-primary';

export interface GroupEditorState {
  id: string | null;
  name: string;
  orgs: string[];
}

interface OrgGroupEditorProps {
  editor: GroupEditorState;
  availableOrgs: string[];
  error: string | null;
  onNameChange: (name: string) => void;
  onToggleOrg: (org: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** Редактор создания/переименования группы организаций. */
export function OrgGroupEditor({
  editor,
  availableOrgs,
  error,
  onNameChange,
  onToggleOrg,
  onCancel,
  onSubmit,
}: OrgGroupEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="border border-border bg-surface rounded-[16px] p-3.5 shadow-sm flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-bold text-foreground" htmlFor="org-group-name">
        {t('settings.orgGroupsName')}
        <input
          id="org-group-name"
          value={editor.name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('settings.orgGroupsNamePlaceholder')}
          className="px-3 py-2 rounded-[12px] bg-input text-[14px] font-normal text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-shadow"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-bold text-foreground">{t('settings.orgGroupsPickOrgs')}</span>
        {availableOrgs.length > 0 ? (
          <div className="max-h-[220px] overflow-y-auto flex flex-col gap-1 pr-1">
            {availableOrgs.map((org) => {
              const checked = editor.orgs.includes(org);
              return (
                <button
                  key={org}
                  type="button"
                  onClick={() => onToggleOrg(org)}
                  // Выделение — цветом плашки и текста + галочкой: без смены
                  // начертания, чтобы текст не «двигался» при отметке.
                  className={cn(ORG_ROW_CLASS, checked && 'bg-primary/10 text-primary')}
                  aria-pressed={checked}
                >
                  <span className="truncate">{org}</span>
                  {checked && <Check className="w-4 h-4 shrink-0" aria-hidden />}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-[13px] text-muted-foreground px-1">{t('settings.orgGroupsNoOrgsAvailable')}</span>
        )}
      </div>

      {error && (
        <span className="text-[13px] text-red-500 font-medium px-1" role="alert">
          {error}
        </span>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] text-[13px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden />
          {t('settings.orgGroupsCancel')}
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors outline-none cursor-pointer"
        >
          <Check className="w-4 h-4" aria-hidden />
          {t('settings.orgGroupsSave')}
        </button>
      </div>
    </div>
  );
}
