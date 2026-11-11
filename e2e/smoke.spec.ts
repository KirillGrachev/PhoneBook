import { expect, test } from '@playwright/test';

test('app shell loads in the browser', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/KMAruda PhoneBook/i);
  await expect(page.locator('body')).toBeVisible();
});
