import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

test('empty search result closes the previously selected contact', async ({ page }) => {
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
  await page.goto('/');
  await expect(page.getByText('Волкова Екатерина Дмитриевна')).toBeVisible();
  await page.getByText('Волкова Екатерина Дмитриевна').click();
  await expect(page.getByRole('heading', { name: /Волкова Екатерина Дмитриевна/ })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Global search' }).fill('zzzz_no_such_contact');
  await expect(page.getByText('No matches found')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Волкова Екатерина Дмитриевна/ })).toHaveCount(0);
});
