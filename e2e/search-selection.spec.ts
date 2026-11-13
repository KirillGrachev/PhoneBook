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
  await expect(page.getByText('Volkova Ekaterina Dmitrievna')).toBeVisible();
  await page.getByText('Volkova Ekaterina Dmitrievna').click();
  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toBeVisible();
  await expect(page.getByText('Менеджер по работе с клиентами', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Отдел продаж', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('ООО «Рога и Копыта»', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Contact QR code (vCard)' }).first().click();
  await expect(page.getByText(/Volkova Ekaterina Dmitrievna/).last()).toBeVisible();
  await page.getByRole('button', { name: /close/i }).click();

  await page.getByRole('searchbox', { name: 'Global search' }).fill('zzzz_no_such_contact');
  await expect(page.getByText('No matches found')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Volkova Ekaterina Dmitrievna/ })).toHaveCount(0);
});
