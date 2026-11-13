import { expect, test } from '@playwright/test';

test('Montserrat is the application font', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.fonts.check('16px Montserrat'));

  const fonts = await page.evaluate(() => {
    const root = document.querySelector('#root');
    const text = document.querySelector('h1');
    return {
      body: getComputedStyle(document.body).fontFamily,
      root: root ? getComputedStyle(root).fontFamily : '',
      heading: text ? getComputedStyle(text).fontFamily : '',
      loaded: document.fonts.check('16px Montserrat'),
    };
  });

  expect(fonts.loaded).toBe(true);
  expect(fonts.body).toContain('Montserrat');
  expect(fonts.root).toContain('Montserrat');
  expect(fonts.heading).toContain('Montserrat');
});
