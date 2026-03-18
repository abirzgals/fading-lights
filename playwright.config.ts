import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5001/',
  },
  webServer: {
    command: 'npx vite --port 5001 --strictPort',
    port: 5001,
    reuseExistingServer: true,
  },
});
