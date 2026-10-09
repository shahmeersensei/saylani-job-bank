/**
 * Security sweep over every API route in the app.
 *
 * Discovers all `route.ts` handlers, invokes them in-process **without a session** and asserts
 * the two invariants that hold regardless of the domain:
 *
 *  1. No endpoint may answer 5xx (an unhandled throw on an anonymous request is a defect).
 *  2. No *private* endpoint may answer 2xx anonymously — the curated allow-list below holds
 *     the genuinely public surface (health, sign-in, OTP, invitation, registration).
 *
 * Anything outside the allow-list that succeeds anonymously is reported as a finding.
 */
import fs from 'node:fs';
import path from 'node:path';
import { call } from './helpers';

const API_ROOT = path.resolve(__dirname, '../../apps/web/src/app/api');

/** Endpoints that are deliberately reachable without a session. */
const PUBLIC = new Set([
  'v1/health',
  'v1/auth/login',
  'v1/auth/logout',
  'v1/auth/otp/request',
  'v1/auth/otp/verify',
  'v1/auth/email-otp/request',
  'v1/auth/email-otp/verify',
  'v1/auth/password/forgot',
  'v1/auth/password/reset',
  'v1/auth/invitations/lookup',
  'v1/auth/invitations/accept',
  'v1/auth/signup/code',
  'v1/auth/signup/complete',
  'v1/applicants/register',
  'v1/companies/register',
]);

type Discovered = { key: string; file: string };

function discover(dir: string, prefix = ''): Discovered[] {
  const out: Discovered[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(...discover(full, childPrefix));
      continue;
    }
    if (entry.name !== 'route.ts') continue;
    const key = prefix ? `${prefix}/route` : 'route';
    const routeKey = prefix.replace(/\/route$/, '');
    out.push({ key: routeKey, file: full });
  }
  return out;
}

const routes = discover(API_ROOT);

/** Public HTTP verbs we attempt; a handler that does not implement one answers 405/404. */
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

describe('anonymous access sweep', () => {
  it('discovers the API surface', () => {
    expect(routes.length).toBeGreaterThanOrEqual(90);
  });

  for (const route of routes) {
    const isPublic = PUBLIC.has(route.key);

    it(`${route.key} never answers 5xx without a session`, async () => {
      const handler = (await import(/* webpackIgnore: true */ route.file)) as Record<
        string,
        unknown
      >;
      const failures: string[] = [];

      for (const verb of VERBS) {
        const fn = handler[verb];
        if (typeof fn !== 'function') continue;
        let status: number | undefined;
        try {
          const response = await call(fn as never, `/api/${route.key}`, {
            method: verb,
            body: verb === 'GET' || verb === 'DELETE' ? undefined : {},
            params: {},
          });
          status = response.status;
          await response.text();
        } catch {
          failures.push(`${verb} threw out of handler`);
          continue;
        }
        if (status !== undefined && status >= 500) {
          failures.push(`${verb} → ${status}`);
        }
        if (!isPublic && status !== undefined && status >= 200 && status < 300) {
          failures.push(`${verb} → ${status} (anonymous success on a private route)`);
        }
      }

      if (failures.length) throw new Error(`${route.key}: ${failures.join(', ')}`);
    }, 30_000);
  }
});
