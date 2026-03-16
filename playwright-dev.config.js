const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000,
  use: {
    baseURL: 'http://localhost:8080',
    headless: false,
  },
  webServer: {
    command: 'npx http-server . -p 8080 --silent',
    port: 8080,
    reuseExistingServer: true,
  },
});
