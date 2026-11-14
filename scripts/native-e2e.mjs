import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { chromium } from 'playwright';

const exe = process.env.PHONEBOOK_NATIVE_EXE ?? 'src-tauri/target/debug/kmaruda-phonebook.exe';
const port = process.env.PHONEBOOK_NATIVE_CDP_PORT ?? '9333';
const endpoint = `http://127.0.0.1:${port}`;
const userData = join(tmpdir(), `phonebook-native-e2e-${process.pid}`);

const app = spawn(exe, {
  env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: userData,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: 'ignore',
});

let appExit = null;
app.once('exit', (code) => {
  appExit = code;
});

let browser;
try {
  let targets;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json`);
      if (response.ok) {
        targets = await response.json();
        if (Array.isArray(targets) && targets.some((target) => target.type === 'page')) break;
      }
    } catch {
      // WebView2 has not opened the debugging endpoint yet.
    }
    await sleep(500);
  }

  if (!targets) {
    throw new Error(`native WebView2 debugging endpoint did not start (app exit=${appExit})`);
  }
  browser = await chromium.connectOverCDP(endpoint);
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().includes('tauri.localhost'));
  if (!page) throw new Error(`native page not found; targets: ${JSON.stringify(targets)}`);

  await page.waitForLoadState('domcontentloaded');
  const heading = page.locator('h1');
  await heading.waitFor({ state: 'visible', timeout: 15_000 });
  const title = await page.title();
  const headingText = (await heading.textContent())?.trim() ?? '';
  if (!/PhoneBook/i.test(title)) throw new Error(`unexpected native title: ${title}`);
  if (!/Directory|Справочник/i.test(headingText)) throw new Error(`unexpected native heading: ${headingText}`);

  const settings = page.getByLabel(/Settings|Настройки/).last();
  await settings.click();
  await page.getByRole('heading', { name: /Settings|Настройки/ }).waitFor({ state: 'visible', timeout: 10_000 });

  console.log(`native E2E ok: title="${title}", heading="${headingText}", settings opened`);
} finally {
  await browser?.close().catch(() => {});
  if (app.pid) {
    spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {
    // WebView2 may still hold a file briefly; the temp folder is disposable.
  }
}
