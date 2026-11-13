import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Хост для разработки на физическом устройстве (TAURI_DEV_HOST).
const devHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 1420,
    strictPort: true,
    host: devHost || '127.0.0.1',
    hmr: devHost ? { protocol: 'ws', host: devHost, port: 1421 } : undefined,
    watch: {
      // Пересборка не должна реагировать на изменения Rust-половины.
      ignored: ['**/src-tauri/**'],
    },
  },
  preview: {
    port: 1420,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) поддерживает manualChunks только как функцию.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
            return 'vendor-query';
          }
          if (/[\\/]node_modules[\\/](motion|framer-motion)[\\/]/.test(id)) {
            return 'vendor-motion';
          }
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) {
            return 'vendor-i18n';
          }
          if (/[\\/]node_modules[\\/](sonner)[\\/]/.test(id)) {
            return 'vendor-toast';
          }
          if (/[\\/]node_modules[\\/](zustand)[\\/]/.test(id)) {
            return 'vendor-state';
          }
          if (/[\\/]node_modules[\\/](react-qr-code|qrcode\.react)[\\/]/.test(id)) {
            return 'vendor-qr';
          }
          if (/[\\/]node_modules[\\/](react-focus-lock|focus-lock)[\\/]/.test(id)) {
            return 'vendor-focus';
          }
          if (/[\\/]node_modules[\\/](tailwind-merge|clsx)[\\/]/.test(id)) {
            return 'vendor-utils';
          }
          // Остальные пакеты — отдельными vendor-чанками по имени пакета,
          // чтобы один «vendor» не разрастался до сотен килобайт.
          const parts =
            id
              .split(/node_modules[\\/]/)
              .pop()
              ?.split(/[\\/]/) ?? [];
          const pkg = parts[0]?.startsWith('@') ? `${parts[0]}-${parts[1] ?? ''}` : (parts[0] ?? 'misc');
          return `vendor-${pkg.replace(/^@/, '').replace(/[^a-z0-9-]/gi, '-')}`;
        },
      },
    },
  },
});
