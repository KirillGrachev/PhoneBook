import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });

test('main window visual baseline', async ({ page }) => {
  // Stable theme/locale and no entry animation for a useful pixel diff.
  await page.addInitScript(() => {
    localStorage.setItem(
      'phonebook-storage',
      JSON.stringify({
        state: { theme: 'light', language: 'en', animationsEnabled: false },
        version: 0,
      }),
    );
  });
  await page.goto('/');
  await page.waitForTimeout(1_500);
  await expect(page.locator('body')).toHaveScreenshot('main-light.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.05,
  });
});
