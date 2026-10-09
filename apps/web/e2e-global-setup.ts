import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

const here = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
/** Mirrors `packages/db/src/seed/dev-data.ts` — the seeded development password. */
const DEV_PASSWORD = 'JobBank-Dev-2026!';

/** Public pages that must be compiled before the first assertion on them. */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/forbidden'];
/** Dashboard pages that only compile once a session cookie is present. */
const PROTECTED_ROUTES = [
  '/staff',
  '/staff/applicants',
  '/account/security?setup=required',
  '/super-admin',
];

/**
 * Playwright global setup.
 *
 * 1. Wipes the fixed-window rate-limit counters (`rl:*`). The suites sign in as the same dev
 *    accounts on every run and the login limiter allows only 5 attempts per email per 15
 *    minutes, so without a reset the second run in a row would fail with 429s.
 * 2. Compiles every route the specs navigate to. `next dev --turbopack` compiles lazily: a cold
 *    route takes far longer than the assertion timeout, which shows up as a Sign in button stuck
 *    in its disabled `pending` state (`router.replace` never resolves) or a 60s `page.goto`.
 */
export default async function globalSetup(): Promise<void> {
  config({ path: path.resolve(here, '../../.env'), quiet: true });

  await clearRateLimits();
  await warmRoutes();
}

async function clearRateLimits(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) return; // rate limiter falls back to in-process memory; nothing shared to clear

  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    // SCAN, never KEYS: KEYS blocks the server for the whole keyspace.
    let cursor = '0';
    let cleared = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rl:*', 'COUNT', 500);
      cursor = next;
      if (keys.length) {
        await redis.del(...keys);
        cleared += keys.length;
      }
    } while (cursor !== '0');
    console.log(`[global-setup] cleared ${cleared} rate-limit counter(s)`);
  } catch (error) {
    // Never fail the run because cleanup could not talk to Redis.
    console.warn(`[global-setup] could not clear rate limits: ${String(error)}`);
  } finally {
    redis.disconnect();
  }
}

async function waitForServer(timeoutMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/health`);
      if (response.ok) return true;
    } catch {
      // Server not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

async function warmRoutes(): Promise<void> {
  if (!(await waitForServer())) {
    console.warn(`[global-setup] ${BASE_URL} never became healthy; skipping route warm-up`);
    return;
  }

  const warmed = new Set<string>();
  const get = async (route: string, cookie?: string) => {
    try {
      const response = await fetch(`${BASE_URL}${route}`, {
        headers: cookie ? { cookie } : undefined,
        redirect: 'follow',
      });
      await response.arrayBuffer();
      warmed.add(route);
    } catch (error) {
      console.warn(`[global-setup] warm-up of ${route} failed: ${String(error)}`);
    }
  };

  for (const route of PUBLIC_ROUTES) await get(route);

  // Sign in once over the API so the dashboard layouts render (and compile) for real.
  let cookie: string | undefined;
  try {
    const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'staff.khi@jobbank.local', password: DEV_PASSWORD }),
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ') || undefined;
    await response.arrayBuffer();
  } catch {
    // Fall through: protected routes then warm as anonymous redirects.
  }

  for (const route of PROTECTED_ROUTES) await get(route, cookie);

  console.log(`[global-setup] warmed ${warmed.size} route(s)`);
}
