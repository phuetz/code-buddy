import { defineConfig, devices } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*-e2e.test.ts',
  timeout: 60000,
  workers: 1,
  use: { ...devices['Pixel 5'] },
});
