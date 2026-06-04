import { defineConfig, devices } from '@playwright/test'

const apiPort = Number(process.env.GIGASTUDY_E2E_API_PORT ?? 18080)
const webPort = Number(process.env.GIGASTUDY_E2E_WEB_PORT ?? 15173)
const apiBaseURL = `http://127.0.0.1:${apiPort}`
const webBaseURL = `http://127.0.0.1:${webPort}`
const reuseExistingServer = process.env.GIGASTUDY_E2E_REUSE_SERVER === 'true'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: webBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },
  ],
  webServer: [
    {
      command: `uv run uvicorn gigastudy_api.main:app --host 127.0.0.1 --port ${apiPort} --app-dir src`,
      cwd: 'apps/api',
      port: apiPort,
      reuseExistingServer,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIGASTUDY_API_STORAGE_ROOT: '../../test-results/e2e-api-storage',
        GIGASTUDY_API_CORS_ORIGINS: webBaseURL,
        GIGASTUDY_API_DATABASE_URL: '',
        GIGASTUDY_API_STORAGE_BACKEND: 'local',
        GIGASTUDY_API_DEEPSEEK_HARMONY_ENABLED: 'false',
        GIGASTUDY_API_DEEPSEEK_NOTATION_REVIEW_ENABLED: 'false',
        GIGASTUDY_API_DEEPSEEK_ENSEMBLE_REVIEW_ENABLED: 'false',
        GIGASTUDY_API_DEEPSEEK_API_KEY: '',
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${webPort}`,
      cwd: 'apps/web',
      port: webPort,
      reuseExistingServer,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_API_BASE_URL: apiBaseURL,
      },
    },
  ],
})
