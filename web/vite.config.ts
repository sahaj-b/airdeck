import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

const devPort = process.env.AIRDECK_PORT ?? '6969';
const viteDevProxy = process.env.AIRDECK_DEV
  ? {
      '/ws': { target: `http://127.0.0.1:${devPort}`, ws: true },
      '/api': { target: `http://127.0.0.1:${devPort}` },
    }
  : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
    },
  },
  clearScreen: false,
  server: viteDevProxy ? { proxy: viteDevProxy, host: true } : undefined,
  build: {
    outDir: resolve(root, '../internal/web/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        join: resolve(root, 'join.html'),
        dashboard: resolve(root, 'dashboard.html'),
      },
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/scheduler')
          )
            return 'react-vendor';
        },
      },
    },
  },
});
