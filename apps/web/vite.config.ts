import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (GitHub Pages, Capacitor).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  server: { host: true },
});
