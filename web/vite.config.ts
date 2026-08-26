import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(root, '../internal/web/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        join: resolve(root, 'join.html'),
        dashboard: resolve(root, 'dashboard.html'),
      },
    },
  },
});
