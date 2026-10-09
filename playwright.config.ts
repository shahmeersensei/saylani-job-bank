import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * `next.config.ts` calls `loadEnvConfig(repoRoot)` which only loads the root `.env` in
 * development, so `next start` boots with no `BETTER_AUTH_SECRET` and every request dies with
 * "BETTER_AUTH_SECRET must be set in production". Rather than change product config, the
 * web-server process is handed the root `.env` explicitly (parsed here — the root workspace has
 * no `dotenv` dependency).
 */
function loadRootEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (key in process.env) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}
loadRootEnv();
// The root `.env` ships `BETTER_AUTH_SECRET=` (empty). Development tolerates it, `next start`
// refuses every request with "BETTER_AUTH_SECRET must be set in production", so the E2E run
// supplies one. Filling it in for real belongs to deployment config, not to the app.
process.env.BETTER_AUTH_SECRET ||= 'e2e-only-secret-e2e-only-secret-e2e';

const PORT = process.env.PORT ?? '3000';
const baseURL = `http://localhost:${PORT}`;

/**
 * Frontend end-to-end tests. Runs against the real server + Docker infra
 * (pnpm infra:up && pnpm db:migrate && pnpm db:seed must have run once).
 *
 * `E2E_PROD=1` builds and serves the production bundle (the default, and what `pnpm test:e2e`
 * sets). Under `next dev`, Turbopack compiles each route on first hit in the same process that
 * serves the API, so a first-visit login POST was measured at 49s — long enough to look like a
 * hang and to blow assertion timeouts. Against a production build every response is
 * milliseconds, which is also what makes the suite fast.
 */
const prod = process.env.E2E_PROD !== '0';
export default defineConfig({
  testDir: './tests/e2e',
  // Resets the shared login rate-limit counters so repeat runs are not blocked by 429s.
  globalSetup: './apps/web/e2e-global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Route compilation is no longer a factor in production mode; two workers keep the
  // session/OTP rate limits comfortably below their ceilings.
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: prod
      ? 'pnpm --filter @jobbank/web build && pnpm --filter @jobbank/web start'
      : 'pnpm --filter @jobbank/web dev',
    // Wait on the API health route (not just /) so the first request in a test does not
    // pay the whole route-compile cost inside a test's own timeout.
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: true,
    timeout: 420_000,
    env: { ...process.env, NODE_ENV: 'production' } as Record<string, string>,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
