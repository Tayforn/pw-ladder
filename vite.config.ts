import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? process.env.VITE_BASE || '/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: 'index.html',
    },
  },
  // Розробка: /api йде на локальний бекенд, тож фронт і API — один origin
  // (cookie сесії працює без CORS, як у проді за Caddy).
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}));
