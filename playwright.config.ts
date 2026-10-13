import { defineConfig, devices } from '@playwright/test';

import { PLATFORM_OWNER } from './tests/e2e/support/accounts';

const isCI = Boolean(process.env.CI);
const baseURL = 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  // Creates the platform owner's login in the local Supabase before any test runs.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : 2,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // For machines with a preinstalled Chromium that differs from Playwright's pinned build.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Every screen must work at 375px (.claude/rules/architecture.md).
    {
      name: 'mobile-375',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: isCI ? 'npm run start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // Added to the inherited environment: the test platform owner may open /platform.
    env: { PLATFORM_ADMIN_EMAILS: PLATFORM_OWNER.email },
  },
});
