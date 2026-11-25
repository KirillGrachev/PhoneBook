import { expect, test, type Page } from '@playwright/test';

const config = {
  theme: 'light',
  language: 'ru',
  globalMode: false,
  savedContactIds: [],
  ldapConfigs: [
    {
      organization: 'TestOrg',
      ldapUrl: 'ldap://dc.test',
      baseDn: 'DC=test',
      bindDn: null,
      useStartTls: false,
      allowInvalidTls: false,
      useIntegratedAuth: true,
      hasPassword: false,
    },
  ],
  testMode: false,
  animationsEnabled: false,
  showAvatars: true,
  syncIntervalHours: 24,
  ldapConnectTimeoutSecs: 15,
  ldapOperationTimeoutSecs: 30,
  hideEmptyContacts: true,
  emailOverrides: {},
  orgGroups: [],
  enterpriseGroupId: null,
  externalPhonebookPath: null,
  externalPhonebookPaths: [],
  externalPhonebookEnabled: false,
  externalPhonebookIntervals: {},
  externalHideAdDuplicates: true,
  managed: false,
  managedProfile: null,
  managedRevision: null,
  version: '0.2.28',
};

const preview = {
  groups: 155,
  removable: 155,
  removableNames: [
    'Иванов Иван',
    'Петров Пётр',
    'Сидоров Сидор',
    'Смирнов Алексей',
    'Кузнецов Дмитрий',
    'Васильев Василий',
  ],
};

async function mockTauri(page: Page, previewOverride = preview) {
  await page.addInitScript(
    ({ config, preview }) => {
      localStorage.setItem('phonebook-language-user', '1');
      let callbackId = 1;
      const callbacks = new Map<number, unknown>();
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback(callback: unknown) {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string) {
          switch (command) {
            case 'load_config':
            case 'save_config':
              return config;
            case 'preview_duplicate_contacts':
              await new Promise((resolve) => setTimeout(resolve, 100));
              return preview;
            case 'deduplicate_contacts':
              return preview.removable;
            case 'count_contacts':
              return 1000;
            case 'list_organizations':
              return ['TestOrg'];
            case 'search_contacts':
              return { items: [], total: 0 };
            case 'get_sync_status':
              return { running: false, organizations: [] };
            case 'frontend_log':
              return null;
            default:
              if (command === 'plugin:event|listen') return 1;
              if (command === 'plugin:window|is_maximized') return false;
              if (command.startsWith('plugin:')) return null;
              return null;
          }
        },
      };
    },
    { config, preview: previewOverride },
  );
}

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

test('duplicate cleanup keeps the settings scroll position and lists real removable records', async ({ page }) => {
  await mockTauri(page);
  await page.goto('/#/settings?view=ad');

  const checkButton = page.getByRole('button', { name: 'Найти и убрать' });
  await expect(checkButton).toBeVisible();

  const scroller = page.locator('[role="dialog"] .overflow-y-auto');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const scrollBefore = await scroller.evaluate((node) => node.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);

  await checkButton.click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Будут удалены:');
  await expect(dialog).toContainText(
    'Иванов Иван, Петров Пётр, Сидоров Сидор, Смирнов Алексей, Кузнецов Дмитрий, Васильев Василий',
  );
  await expect(dialog).toContainText('и ещё 149');
  await expect(dialog).not.toContainText('Примеры:');

  // The settings page must not jump to the top when the dialog opens.
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(scrollBefore);

  await page.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
});

test('duplicate dialog lists every name when there are seven or fewer records', async ({ page }) => {
  await mockTauri(page, {
    groups: 3,
    removable: 3,
    removableNames: ['Иванов Иван', 'Петров Пётр', 'Сидоров Сидор'],
  });
  await page.goto('/#/settings?view=ad');
  await page.getByRole('button', { name: 'Найти и убрать' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Будут удалены: Иванов Иван, Петров Пётр, Сидоров Сидор');
  await expect(dialog).not.toContainText('и ещё');
});
