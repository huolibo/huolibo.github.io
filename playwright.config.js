import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  timeout: 45000,
  workers: 1,
  use: {
    browserName: process.env.TEST_BROWSER || 'chromium',
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
    screenshot: 'only-on-failure'
  },
  webServer: { command: 'pnpm serve:test', url: 'http://127.0.0.1:4173', reuseExistingServer: true }
});
