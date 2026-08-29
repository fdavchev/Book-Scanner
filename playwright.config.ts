import { defineConfig, devices } from '@playwright/test'

/**
 * The end-to-end tests run against the *built* app served by `vite preview`, not the dev
 * server: the service worker, the manifest and the offline behaviour only exist in a
 * production build, and those are the things most worth testing.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // OCR is genuinely slow — a cold worker load plus a scan is tens of seconds.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    permissions: ['camera'],
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
    { name: 'iphone', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
