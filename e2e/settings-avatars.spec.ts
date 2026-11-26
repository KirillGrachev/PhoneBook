import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

test('the avatar toggle is persisted across reloads', async ({ page }) => {
  await page.goto('/#/settings?view=interface');

  const toggle = page.getByRole('switch', { name: 'Show avatars' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(toggle).not.toBeChecked();

  await page.reload();
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(toggle).toBeChecked();
});
