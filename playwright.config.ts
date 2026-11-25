import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
    launchOptions: {
      // Sandboxed CI containers often have a tiny /dev/shm and no user namespaces.
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
