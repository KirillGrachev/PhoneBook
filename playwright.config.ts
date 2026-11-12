import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

