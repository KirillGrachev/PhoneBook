import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**'],
      exclude: ['src/**/*.test.*', 'src/setupTests.ts', 'src/main.tsx'],
      // Нижняя граница текущего покрытия: не даёт ему молча упасть.
      thresholds: {
        statements: 35,
        branches: 25,
        functions: 28,
        lines: 35,
      },
    },
  },
});
