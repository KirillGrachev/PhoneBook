import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Check, Download, Layers, Pencil, Pin, Plus, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { configApi } from '@/api/directory';
import type { OrgGroupsFileDto } from '@/api/contracts';
import { CopyButton } from '@/components/CopyButton';
import { useOrganizations } from '@/hooks/useDirectory';
import { translateBackendError } from '@/lib/errors';
import {
  buildOrgGroupsFile,
  mergeOrgGroups,
  newOrgGroupId,
  normalizeOrgName,
  OrgGroupsFileError,
  ORG_GROUPS_SHARE_FILE_NAME,
  validateOrgGroupsFile,
} from '@/lib/orgGroups';
import { isTauri } from '@/api/backend';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/useAppStore';

/** Черновик редактора группы: `id = null` — создание новой. */
interface GroupEditorState {
  id: string | null;
  name: string;
  orgs: string[];
}

const ACTION_BUTTON_CLASS =
  'p-2 rounded-[10px] text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer';

const ORG_ROW_CLASS =
  'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[12px] text-[13px] text-left outline-none transition-colors cursor-pointer border border-transparent hover:bg-surface-hover focus-visible:border-primary';

/**
 * Группы организаций: объединение фильтров под одним названием.
 *
 * * в глобальной версии группа заменяет в фильтре поглощённые организации;
 * * отмеченная значком группа задаёт состав вкладки «КМАруда»
 *   не глобальной версии (какие учётки учитываются в списке).
 */
export function SettingsGroupsView() {
  const { t } = useTranslation();

  const orgGroups = useAppStore((state) => state.orgGroups);
  const saveOrgGroup = useAppStore((state) => state.saveOrgGroup);
  const removeOrgGroup = useAppStore((state) => state.removeOrgGroup);
  const setOrgGroups = useAppStore((state) => state.setOrgGroups);
  const enterpriseGroupId = useAppStore((state) => state.enterpriseGroupId);
  const setEnterpriseGroupId = useAppStore((state) => state.setEnterpriseGroupId);
  const ldapConfigs = useAppStore((state) => state.ldapConfigs);

  const { data: directoryOrgs = [] } = useOrganizations();
  const [editor, setEditor] = useState<GroupEditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<'export' | 'import' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Экспорт групп в файл обмена: в десктопе файл пишет Rust в «Документы»
   * (путь показываем с копированием), в демо-режиме браузера — скачивание.
   */
  const handleExport = async () => {
    if (orgGroups.length === 0) {
      setError(t('settings.orgGroupsExportEmpty'));
      return;
    }
    setError(null);
    setShareBusy('export');
    try {
      if (isTauri()) {
        const path = await configApi.exportOrgGroupsFile();
        setExportedPath(path);
        toast.success(t('settings.orgGroupsExported'), { description: path });
      } else {
        const blob = new Blob([JSON.stringify(buildOrgGroupsFile(orgGroups, enterpriseGroupId), null, 2)], {
          type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = ORG_GROUPS_SHARE_FILE_NAME;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(t('settings.orgGroupsExportedBrowser'));
      }
    } catch (exportError) {
      toast.error(translateBackendError(exportError, t), { id: 'org-groups-export-error' });
    } finally {
      setShareBusy(null);
    }
  };

  /** Применение проверенного файла: слияние чистыми функциями, персист — стором. */
  const applyImportedFile = (file: OrgGroupsFileDto) => {
    const merged = mergeOrgGroups(orgGroups, file, enterpriseGroupId);
    setOrgGroups(merged.groups);
    setEnterpriseGroupId(merged.enterpriseGroupId);
    setError(null);
    toast.success(t('settings.orgGroupsImported', { count: file.groups.length }));
  };

  /** Импорт: выбор файла нативным picker'ом webview, валидация формата на Rust. */
  const handleImportPicker = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setShareBusy('import');
    try {
      const content = await file.text();
      const parsed = isTauri()
        ? await configApi.parseOrgGroupsFile(content)
        : validateOrgGroupsFile(JSON.parse(content));
      applyImportedFile(parsed);
    } catch (importError) {
      const reason =
        importError instanceof OrgGroupsFileError
          ? importError.message
          : importError instanceof SyntaxError
            ? t('settings.orgGroupsImportNotJson')
            : translateBackendError(importError, t);
      toast.error(t('settings.orgGroupsImportFailed', { reason }), {
        id: 'org-groups-import-error',
        duration: 8000,
      });
    } finally {
      setShareBusy(null);
    }
  };

  // Доступные организации: справочник кэша + организации AD-подключений +
  // уже входящие в группы (могли исчезнуть из AD после синхронизации).
  // Имена приводятся к единому виду: варианты с лишними пробелами не должны
  // выглядеть «двойниками» одной организации.
  const availableOrgs = useMemo(() => {
    const names = new Set<string>();
    for (const org of [...directoryOrgs, ...ldapConfigs.map((config) => config.organization)]) {
      const name = normalizeOrgName(org ?? '');
      if (name) {
        names.add(name);
      }
    }
    for (const group of orgGroups) {
      for (const org of group.orgs) {
        const name = normalizeOrgName(org);
        if (name) {
          names.add(name);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [directoryOrgs, ldapConfigs, orgGroups]);

  const openCreate = () => {
    setEditor({ id: null, name: '', orgs: [] });
    setError(null);
  };
  const openEdit = (id: string) => {
    const group = orgGroups.find((item) => item.id === id);
    if (!group) {
      return;
    }
    setEditor({ id: group.id, name: group.name, orgs: group.orgs.map(normalizeOrgName) });
    setError(null);
  };
  const toggleOrg = (org: string) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            orgs: current.orgs.includes(org) ? current.orgs.filter((item) => item !== org) : [...current.orgs, org],
          }
        : current,
    );
  };
  const submit = () => {
    if (!editor) {
      return;
    }
    const name = editor.name.trim();
    if (!name) {
      setError(t('settings.orgGroupsNameEmpty'));
      return;
    }
    const duplicate = orgGroups.some(
      (group) => group.id !== editor.id && group.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setError(t('settings.orgGroupsNameDuplicate'));
      return;
    }
    saveOrgGroup({ id: editor.id ?? newOrgGroupId(), name, orgs: editor.orgs });
    setEditor(null);
    setError(null);
  };

  return (
    <div className="flex flex-col gap-4 w-full" aria-labelledby="org-groups-heading">
      <p className="text-[13px] text-muted-foreground leading-snug px-1">{t('settings.orgGroupsDesc')}</p>

      <div className="flex flex-col gap-3">
        {orgGroups.length === 0 && !editor && (
          <div className="border border-dashed border-border rounded-[16px] p-5 text-center text-[13px] text-muted-foreground">
            {t('settings.orgGroupsEmpty')}
          </div>
        )}

        {orgGroups.map((group) => {
          const pinned = enterpriseGroupId === group.id;
          return (
            <section
              key={group.id}
              className="border border-border bg-surface rounded-[16px] p-3.5 shadow-sm flex flex-col gap-2.5"
              aria-label={group.name}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-bold text-[15px] text-foreground min-w-0">
                  <Layers className="w-4 h-4 text-primary shrink-0" aria-hidden />
                  <span className="truncate">{group.name}</span>
                </span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEnterpriseGroupId(pinned ? null : group.id)}
                    className={cn(ACTION_BUTTON_CLASS, pinned && 'text-primary hover:text-primary')}
                    aria-label={t('settings.orgGroupsEnterprise')}
                    aria-pressed={pinned}
                    title={t('settings.orgGroupsEnterprise')}
                  >
                    <Pin className={cn('w-4 h-4', pinned && 'fill-primary/20')} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(group.id)}
                    className={ACTION_BUTTON_CLASS}
                    aria-label={t('settings.orgGroupsEdit')}
                    title={t('settings.orgGroupsEdit')}
                  >
                    <Pencil className="w-4 h-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeOrgGroup(group.id)}
                    className={cn(ACTION_BUTTON_CLASS, 'hover:text-red-500')}
                    aria-label={t('settings.orgGroupsDelete')}
                    title={t('settings.orgGroupsDelete')}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                </span>
              </div>

              {group.orgs.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {group.orgs.map((org) => (
                    <li key={org} className="px-2 py-0.5 rounded-[8px] bg-input text-[12px] text-foreground/80">
                      {org}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-[13px] text-muted-foreground">{t('settings.orgGroupsNoOrgs')}</span>
              )}

              {pinned && (
                <span className="text-[12px] text-primary font-medium">{t('settings.orgGroupsEnterpriseHint')}</span>
              )}
            </section>
          );
        })}
      </div>

      {editor ? (
        <div className="border border-border bg-surface rounded-[16px] p-3.5 shadow-sm flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-bold text-foreground" htmlFor="org-group-name">
            {t('settings.orgGroupsName')}
            <input
              id="org-group-name"
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
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
                      onClick={() => toggleOrg(org)}
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
              onClick={() => {
                setEditor(null);
                setError(null);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] text-[13px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors outline-none cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsCancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-[12px] bg-primary text-white text-[13px] font-bold hover:bg-primary-hover transition-colors outline-none cursor-pointer"
            >
              <Check className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsSave')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {exportedPath && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-[12px] bg-input text-[12px] text-muted-foreground min-w-0">
              <span className="truncate flex-1 min-w-0" title={exportedPath}>
                {exportedPath}
              </span>
              <CopyButton text={exportedPath} variant="ghost" className="w-7 h-7" iconClassName="w-3.5 h-3.5" />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover active:translate-y-[1px] text-[14px] font-bold text-foreground shadow-sm transition-all outline-none cursor-pointer"
            >
              <Plus className="w-4 h-4 text-primary" aria-hidden />
              {t('settings.orgGroupsCreate')}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={shareBusy !== null}
              title={t('settings.orgGroupsExport')}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover active:translate-y-[1px] text-[13px] font-bold text-muted-foreground hover:text-foreground shadow-sm transition-all outline-none cursor-pointer disabled:opacity-60"
            >
              <Download className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsExport')}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={shareBusy !== null}
              title={t('settings.orgGroupsImport')}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover active:translate-y-[1px] text-[13px] font-bold text-muted-foreground hover:text-foreground shadow-sm transition-all outline-none cursor-pointer disabled:opacity-60"
            >
              <Upload className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsImport')}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportPicker}
            className="hidden"
            tabIndex={-1}
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
