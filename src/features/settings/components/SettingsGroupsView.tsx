import { useMemo, useRef, useState, type ChangeEvent } from 'react';
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
 * In global mode the group replaces nested organizations in the filter; the
 * pinned group defines which accounts belong to the enterprise tab.
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
   * ÃƒÂÃ‚Â­ÃƒÂÃ‚ÂºÃƒâ€˜Ã‚ÂÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã¢â‚¬Å¡ ÃƒÂÃ‚Â³Ãƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¿ ÃƒÂÃ‚Â² Ãƒâ€˜Ã¢â‚¬Å¾ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â» ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â±ÃƒÂÃ‚Â¼ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â°: ÃƒÂÃ‚Â² ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒâ€˜Ã‚ÂÃƒÂÃ‚ÂºÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¿ÃƒÂÃ‚Âµ Ãƒâ€˜Ã¢â‚¬Å¾ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â» ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â‚¬Å¡ Rust ÃƒÂÃ‚Â² Ãƒâ€šÃ‚Â«ÃƒÂÃ¢â‚¬ÂÃƒÂÃ‚Â¾ÃƒÂÃ‚ÂºÃƒâ€˜Ã†â€™ÃƒÂÃ‚Â¼ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â‚¬Â¹Ãƒâ€šÃ‚Â»
   * (ÃƒÂÃ‚Â¿Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã…â€™ ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°ÃƒÂÃ‚Â·Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Â²ÃƒÂÃ‚Â°ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¼ Ãƒâ€˜Ã‚Â ÃƒÂÃ‚ÂºÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¸Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¼), ÃƒÂÃ‚Â² ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¾-Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â¶ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¼ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â±Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â°Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â·ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â° ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Ãƒâ€˜Ã‚ÂÃƒÂÃ‚ÂºÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â²ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âµ.
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

  /** ÃƒÂÃ…Â¸Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¼ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â²ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â³ÃƒÂÃ‚Â¾ Ãƒâ€˜Ã¢â‚¬Å¾ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â»ÃƒÂÃ‚Â°: Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âµ Ãƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸ Ãƒâ€˜Ã¢â‚¬Å¾Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â½ÃƒÂÃ‚ÂºÃƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸, ÃƒÂÃ‚Â¿ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¼. */
  const applyImportedFile = (file: OrgGroupsFileDto) => {
    const merged = mergeOrgGroups(orgGroups, file, enterpriseGroupId);
    setOrgGroups(merged.groups);
    setEnterpriseGroupId(merged.enterpriseGroupId);
    setError(null);
    toast.success(t('settings.orgGroupsImported', { count: file.groups.length }));
  };

  /** ÃƒÂÃ‹Å“ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã¢â‚¬Å¡: ÃƒÂÃ‚Â²Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Â±ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ Ãƒâ€˜Ã¢â‚¬Å¾ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â»ÃƒÂÃ‚Â° ÃƒÂÃ‚Â½ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â²ÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Â¼ picker'ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¼ webview, ÃƒÂÃ‚Â²ÃƒÂÃ‚Â°ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â´ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚Â Ãƒâ€˜Ã¢â‚¬Å¾ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Å¡ÃƒÂÃ‚Â° ÃƒÂÃ‚Â½ÃƒÂÃ‚Â° Rust. */
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

  // ÃƒÂÃ¢â‚¬ÂÃƒÂÃ‚Â¾Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â³ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â·ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¸: Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â°ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âº ÃƒÂÃ‚ÂºÃƒâ€˜Ã‚ÂÃƒâ€˜Ã‹â€ ÃƒÂÃ‚Â° + ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â³ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â·ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¸ AD-ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â´ÃƒÂÃ‚ÂºÃƒÂÃ‚Â»Ãƒâ€˜Ã…Â½Ãƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¹ +
  // Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¶ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â²Ãƒâ€˜Ã¢â‚¬Â¦ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â´Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Â°ÃƒÂÃ‚Â¸ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â² ÃƒÂÃ‚Â³Ãƒâ€˜Ã¢â€šÂ¬Ãƒâ€˜Ã†â€™ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â‚¬Â¹ (ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â³ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Â¡ÃƒÂÃ‚ÂµÃƒÂÃ‚Â·ÃƒÂÃ‚Â½Ãƒâ€˜Ã†â€™Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã…â€™ ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â· AD ÃƒÂÃ‚Â¿ÃƒÂÃ‚Â¾Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â»ÃƒÂÃ‚Âµ Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â¸ÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¦Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â·ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¸).
  // ÃƒÂÃ‹Å“ÃƒÂÃ‚Â¼ÃƒÂÃ‚ÂµÃƒÂÃ‚Â½ÃƒÂÃ‚Â° ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â´Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã‚ÂÃƒâ€˜Ã‚Â ÃƒÂÃ‚Âº ÃƒÂÃ‚ÂµÃƒÂÃ‚Â´ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¼Ãƒâ€˜Ã†â€™ ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â´Ãƒâ€˜Ã†â€™: ÃƒÂÃ‚Â²ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã¢â‚¬Â¹ Ãƒâ€˜Ã‚Â ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¸Ãƒâ€˜Ã‹â€ ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â¿Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â±ÃƒÂÃ‚ÂµÃƒÂÃ‚Â»ÃƒÂÃ‚Â°ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸ ÃƒÂÃ‚Â½ÃƒÂÃ‚Âµ ÃƒÂÃ‚Â´ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â»ÃƒÂÃ‚Â¶ÃƒÂÃ‚Â½Ãƒâ€˜Ã¢â‚¬Â¹
  // ÃƒÂÃ‚Â²Ãƒâ€˜Ã¢â‚¬Â¹ÃƒÂÃ‚Â³ÃƒÂÃ‚Â»Ãƒâ€˜Ã‚ÂÃƒÂÃ‚Â´ÃƒÂÃ‚ÂµÃƒâ€˜Ã¢â‚¬Å¡Ãƒâ€˜Ã…â€™ Ãƒâ€šÃ‚Â«ÃƒÂÃ‚Â´ÃƒÂÃ‚Â²ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¹ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚ÂºÃƒÂÃ‚Â°ÃƒÂÃ‚Â¼ÃƒÂÃ‚Â¸Ãƒâ€šÃ‚Â» ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â´ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¾ÃƒÂÃ‚Â¹ ÃƒÂÃ‚Â¾Ãƒâ€˜Ã¢â€šÂ¬ÃƒÂÃ‚Â³ÃƒÂÃ‚Â°ÃƒÂÃ‚Â½ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â·ÃƒÂÃ‚Â°Ãƒâ€˜Ã¢â‚¬Â ÃƒÂÃ‚Â¸ÃƒÂÃ‚Â¸.
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
    <div className="flex flex-col gap-4 w-full">
      <p className="text-[13px] text-muted-foreground leading-snug px-1">{t('settings.orgGroupsDesc')}</p>

      <div className="flex flex-col gap-3">
        {orgGroups.length === 0 && !editor && (
          <div className="border border-dashed border-border rounded-[16px] p-5 text-center text-[13px] text-muted-foreground">
            {t('settings.orgGroupsEmpty')}
          </div>
        )}

        {orgGroups.map((group) => (
          <OrgGroupCard
            key={group.id}
            group={group}
            pinned={enterpriseGroupId === group.id}
            onTogglePin={() => setEnterpriseGroupId(enterpriseGroupId === group.id ? null : group.id)}
            onEdit={() => openEdit(group.id)}
            onDelete={() => removeOrgGroup(group.id)}
          />
        ))}
      </div>

      {editor ? (
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
              title={t('settings.orgGroupsImport')}
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
