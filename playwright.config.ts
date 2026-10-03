import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',

  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/native-touch.test.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: executablePath ? { executablePath } : {} },
    },
    { name: 'firefox', testIgnore: '**/native-touch.test.ts', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', testIgnore: '**/native-touch.test.ts', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-webkit', testMatch: ['**/gesture-contract.test.ts', '**/site-icons.test.ts', '**/storage-recovery.test.ts', '**/held-read-intent.test.ts', '**/thumbnail-actions.test.ts', '**/fit-width.test.ts', '**/password-recovery.test.ts'], use: { ...devices['iPhone 13'] } },
    {
      name: 'tablet',
      testMatch: ['**/responsive.test.ts', '**/native-touch.test.ts', '**/gesture-contract.test.ts', '**/site-icons.test.ts', '**/storage-recovery.test.ts', '**/held-read-intent.test.ts', '**/thumbnail-actions.test.ts', '**/fit-width.test.ts', '**/password-recovery.test.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true, launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      name: 'mobile',
      testMatch: ['**/responsive.test.ts', '**/native-touch.test.ts', '**/gesture-contract.test.ts', '**/site-icons.test.ts', '**/storage-recovery.test.ts', '**/held-read-intent.test.ts', '**/thumbnail-actions.test.ts', '**/fit-width.test.ts', '**/password-recovery.test.ts'],
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, defaultBrowserType: 'chromium', launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  // Test the deployable bundle. Vite dev can discover dependencies while PDF
  // workers load and force a page reload, discarding a test's in-memory book.
  webServer: externalBaseURL ? undefined : {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
