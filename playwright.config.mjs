import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    },
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  projects: [
    // Layer 3: E2E Functional — user journeys (Desktop Chrome)
    {
      name: 'functional',
      testMatch: 'e2e/functional/**/*.spec.ts',
      testIgnore: [
        // Covered by onboarding project (Pixel 7 viewport)
        'e2e/functional/onboarding-flow.spec.ts',
        'e2e/functional/css-antipattern-verification.spec.ts',
        'e2e/functional/detail-sheet-dismiss.spec.ts',
        'e2e/functional/dashboard-lane-classification.spec.ts',
        'e2e/functional/toast-notification.spec.ts',
        'e2e/functional/artist-image-ui.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:9000',
      },
    },
    // Layer 3: E2E Functional — onboarding flows (Pixel 7 mobile)
    {
      name: 'onboarding',
      testMatch: [
        'e2e/functional/onboarding-flow.spec.ts',
        'e2e/functional/css-antipattern-verification.spec.ts',
        'e2e/functional/detail-sheet-dismiss.spec.ts',
        'e2e/functional/dashboard-lane-classification.spec.ts',
        'e2e/functional/toast-notification.spec.ts',
        'e2e/functional/artist-image-ui.spec.ts',
      ],
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://localhost:9000',
      },
    },
    // Layer 3: Smoke — console error detection
    {
      name: 'smoke',
      testMatch: 'e2e/smoke/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:9000',
      },
    },
    // Layer 4: Visual Regression — layout screenshot comparison (iPhone 14 viewport, Chromium)
    {
      name: 'mobile-visual',
      testMatch: 'e2e/visual/**/*.spec.ts',
      testIgnore: 'e2e/visual/**/*.auth.visual.spec.ts',
      use: {
        ...devices['iPhone 14'],
        // Override WebKit default to Chromium — only Chromium is installed in CI
        browserName: 'chromium',
        baseURL: 'http://localhost:9000',
      },
    },
    // Layer 4: Visual Regression — authenticated pages
    {
      name: 'authenticated-visual',
      testMatch: 'e2e/visual/**/*.auth.visual.spec.ts',
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        baseURL: 'http://localhost:9000',
        storageState: '.auth/storageState.json',
      },
    },
    // Layer 5: PWA — service worker tests (non-authenticated)
    {
      name: 'pwa',
      testMatch: 'e2e/pwa/**/*.spec.ts',
      testIgnore: [
        // Requires auth storageState — covered by authenticated project
        'e2e/pwa/pwa-settings.spec.ts',
        // Requires Service Worker + offline — not available in CI headless
        'e2e/pwa/pwa-offline-cache.spec.ts',
        // Requires beforeinstallprompt — not available in CI headless
        'e2e/pwa/pwa-install-prompt.spec.ts',
      ],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:9000',
      },
    },
    // Authenticated E2E (non-visual)
    {
      name: 'authenticated',
      testMatch: 'e2e/pwa/pwa-settings.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/storageState.json',
      },
    },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm start',
    port: 9000,
    reuseExistingServer: !process.env.CI,
  },
});
