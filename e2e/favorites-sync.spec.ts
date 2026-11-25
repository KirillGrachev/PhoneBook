import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'phonebook-storage',
      JSON.stringify({
        state: {
          theme: 'light',
          language: 'en',
          animationsEnabled: false,
          testMode: true,
          savedContactIds: [],
        },
        version: 0,
      }),
    );
  });
});

test('removing a favorite in My contacts is immediately reflected after switching to search', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Holding' }).click();

  const searchbox = page.getByRole('searchbox', { name: 'Global search' });
  await searchbox.fill('Volkova');
  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toBeVisible();

  await page.getByRole('button', { name: 'Save Contact' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  // Remove from the favorites tab, then immediately jump back to the directory.
  await page.getByRole('tab', { name: 'My Contacts' }).click();
  await page.getByRole('button', { name: 'Saved' }).click();
  await page.getByRole('tab', { name: 'Holding' }).click();

  // The same contact must now offer ADD, not removal, and the directory list
  // must not expose a quick-remove action outside "My contacts".
  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Contact' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove from my contacts' })).toHaveCount(0);
});

test('removing a favorite on a search tab keeps the card open and unsaved', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Holding' }).click();

  const searchbox = page.getByRole('searchbox', { name: 'Global search' });
  await searchbox.fill('Volkova');
  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toBeVisible();

  await page.getByRole('button', { name: 'Save Contact' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Saved' }).click();

  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Contact' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved' })).toHaveCount(0);
});
