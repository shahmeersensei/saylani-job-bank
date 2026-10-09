/**
 * Authenticated sweep: every API route is invoked while signed in as STAFF and as EMPLOYER.
 *
 * Catches the class of defects a per-endpoint suite misses: unhandled throws (5xx) on a valid
 * session, and routes that answer 404/405 to a real user. Expected-domain assertions live in
 * the per-domain spec files; this file only guarantees the handler survives the request.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Jar, call, signIn } from './helpers';

const API_ROOT = path.resolve(__dirname, '../../apps/web/src/app/api');
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

function discover(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const child = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(...discover(full, child));
      continue;
    }
    if (entry.name === 'route.ts') out.push(prefix);
  }
  return out;
}

const routes = discover(API_ROOT);

async function withSession(email: string): Promise<Jar> {
  const { jar } = await signIn(email);
  return jar;
}

describe('authenticated handler sweep', () => {
  let staff: Jar;
  let employer: Jar;

  beforeAll(async () => {
    staff = await withSession('staff.khi@jobbank.local');
    employer = await withSession('employer@jobbank.local');
  });

  for (const key of routes) {
    it(`${key} does not throw with a signed-in session`, async () => {
      const handler = (await import(
        /* webpackIgnore: true */ path.join(API_ROOT, key, 'route.ts')
      )) as Record<string, unknown>;
      const failures: string[] = [];

      for (const [label, jar] of [
        ['staff', staff],
        ['employer', employer],
      ] as Array<[string, Jar]>) {
        for (const verb of VERBS) {
          const fn = handler[verb];
          if (typeof fn !== 'function') continue;
          try {
            const response = await call(fn as never, `/api/${key}`, {
              method: verb,
              body: verb === 'GET' || verb === 'DELETE' ? undefined : {},
              jar,
              params: {},
            });
            const status = response.status;
            await response.text();
            if (status >= 500) failures.push(`${label}/${verb} → ${status}`);
          } catch (error) {
            failures.push(`${label}/${verb} threw: ${String(error).slice(0, 160)}`);
          }
        }
      }

      if (failures.length) throw new Error(`${key}: ${failures.join('; ')}`);
    }, 30_000);
  }
});
