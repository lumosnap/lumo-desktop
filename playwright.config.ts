import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for Electron E2E testing
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    trace: 'on-first-retry',
    video: 'on-first-retry',
    screenshot: 'only-on-failure'
  },

  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts'
    }
  ],

  // Global timeout for Electron app startup
  timeout: 60000,

  // Expect timeout for assertions
  expect: {
    timeout: 10000
  }
})
