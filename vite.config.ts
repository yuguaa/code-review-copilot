import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// 前端 SPA：根目录 web/，开发时把 /api 代理到 Hono（:8787）。
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@web': fileURLToPath(new URL('./web', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});
