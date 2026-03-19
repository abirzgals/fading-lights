import { defineConfig } from 'vite';

export default defineConfig({
  base: '/fading-lights/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5001,
  },
});
