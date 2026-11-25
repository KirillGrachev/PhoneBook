import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Export, Import, Plus } from '@/components/icons';
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
import { useAppStore } from '@/store/useAppStore';

import { OrgGroupCard } from './OrgGroupCard';
import { OrgGroupEditor, type GroupEditorState } from './OrgGroupEditor';

/**
 * Organization groups: combine filters under one name.
 *
 * In global mode the group replaces nested organizations in the filter.
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
  const editorRef = useRef<HTMLDivElement>(null);
  const editorId = editor?.id ?? null;
  const editorOpen = editor !== null;

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    const node = editorRef.current;
    if (!node) {
      return;
    }
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    node.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, [editorId, editorOpen]);

  /**
   * Exporting groups to an exchange file: in the desktop Rust writes the file to "Documents"
   * (the path is shown with a copy action); in the browser demo mode — a download.
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

  /** Applying a validated file: merging with pure functions, persistence by the store. */
  const applyImportedFile = (file: OrgGroupsFileDto) => {
    // The enterprise-group pin was removed; the file may still contain it
    // from an older export, but it is intentionally ignored.
    const merged = mergeOrgGroups(orgGroups, file, enterpriseGroupId);
    setOrgGroups(merged.groups);
    setError(null);
    toast.success(t('settings.orgGroupsImported', { count: file.groups.length }));
  };

  /** Import: file selection via the native webview picker, format validation in Rust. */
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

  // Available organizations: the cache lookup + AD connection organizations +
  // organizations already included in groups (they may have disappeared from AD after sync).
  // Names are brought to a canonical form: variants with extra spaces must not
  // look like "twins" of the same organization.
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

  const editorContent = editor ? (
    <OrgGroupEditor
      editor={editor}
      availableOrgs={availableOrgs}
      error={error}
      onNameChange={(name) => setEditor({ ...editor, name })}
      onToggleOrg={toggleOrg}
      onCancel={() => {
        setEditor(null);
        setError(null);
      }}
      onSubmit={submit}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4 w-full">
      <p className="text-[13px] text-muted-foreground leading-snug px-1">{t('settings.orgGroupsDesc')}</p>

      <div className="flex flex-col gap-3">
        {orgGroups.length === 0 && !editor && (
          <div className="border border-dashed border-border rounded-[16px] p-5 text-center text-[13px] text-muted-foreground">
            {t('settings.orgGroupsEmpty')}
          </div>
        )}

        {orgGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-3">
            <OrgGroupCard
              group={group}
              pinned={enterpriseGroupId === group.id}
              onTogglePin={() => setEnterpriseGroupId(enterpriseGroupId === group.id ? null : group.id)}
              onEdit={() => openEdit(group.id)}
              onDelete={() => removeOrgGroup(group.id)}
            />
            <AnimatePresence initial={false}>
              {editor?.id === group.id && (
                <motion.div
                  ref={editorRef}
                  key={`group-editor-${group.id}`}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="scroll-mt-24"
                >
                  {editorContent}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {editor && editor.id === null && (
          <motion.div
            ref={editorRef}
            key="new-group-editor"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="scroll-mt-24"
          >
            {editorContent}
          </motion.div>
        )}
      </AnimatePresence>

      {!editor && (
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
              className="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover text-[14px] font-bold text-foreground shadow-sm transition-all outline-none cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsCreate')}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={shareBusy !== null}
              title={t('settings.orgGroupsExport')}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover text-[13px] font-bold text-muted-foreground hover:text-foreground shadow-sm transition-all outline-none cursor-pointer disabled:opacity-60"
            >
              <Export className="w-4 h-4" aria-hidden />
              {t('settings.orgGroupsExport')}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={shareBusy !== null}
              title={t('settings.orgGroupsImportHint')}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-[16px] border border-border bg-surface hover:bg-surface-hover text-[13px] font-bold text-muted-foreground hover:text-foreground shadow-sm transition-all outline-none cursor-pointer disabled:opacity-60"
            >
              <Import className="w-4 h-4" aria-hidden />
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
