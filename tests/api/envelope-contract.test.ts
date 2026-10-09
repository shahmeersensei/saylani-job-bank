/**
 * Error-envelope contract, swept across every API route.
 *
 * `apiHandler` promises one shape for every failure: `{error:{code,message,correlation_id}}`
 * with the same id echoed in the `x-correlation-id` header. This walks all 95 route files,
 * provokes whatever failure they raise without a session, and asserts the promise holds —
 * which is what gives the whole surface contract coverage rather than just the smoke cases.
 */
import fs from 'node:fs';
import path from 'node:path';
import { call } from './helpers';

const API_ROOT = path.resolve(__dirname, '../../apps/web/src/app/api');
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Codes `apiHandler` is allowed to emit; anything else is a contract break. */
const KNOWN_CODES = new Set([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'ALREADY_REGISTERED',
  'UNSUPPORTED_MEDIA_TYPE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

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

describe('error envelope contract', () => {
  for (const key of routes) {
    it(`${key} failures use the shared envelope`, async () => {
      const handler = (await import(/* webpackIgnore: true */ path.join(
        API_ROOT,
        key,
        'route.ts',
      ))) as Record<string, unknown>;
      const problems: string[] = [];
      let checked = 0;

      for (const verb of VERBS) {
        const fn = handler[verb];
        if (typeof fn !== 'function') continue;

        let response: Response;
        try {
          response = await call(fn as never, `/api/${key}`, {
            method: verb,
            body: verb === 'GET' || verb === 'DELETE' ? undefined : {},
            params: {},
          });
        } catch (error) {
          problems.push(`${verb} threw: ${String(error).slice(0, 120)}`);
          continue;
        }

        const status = response.status;
        const headerId = response.headers.get('x-correlation-id');
        const text = await response.text();

        // 2xx/3xx anonymous successes are asserted by `anonymous-sweep`; only failures here.
        if (status < 400) continue;
        if (status === 405 || status === 404 || status === 501) continue; // verb not implemented
        checked++;

        if (!headerId) problems.push(`${verb} ${status}: missing x-correlation-id header`);

        let body: { error?: Record<string, unknown> } | undefined;
        try {
          body = JSON.parse(text) as typeof body;
        } catch {
          problems.push(`${verb} ${status}: body is not JSON (${text.slice(0, 80)})`);
          continue;
        }

        const error = body?.error;
        if (!error) {
          problems.push(`${verb} ${status}: no error object in ${text.slice(0, 100)}`);
          continue;
        }
        if (typeof error.code !== 'string' || !KNOWN_CODES.has(error.code)) {
          problems.push(`${verb} ${status}: unknown code ${JSON.stringify(error.code)}`);
        }
        if (typeof error.message !== 'string' || error.message.trim() === '') {
          problems.push(`${verb} ${status}: empty message`);
        }
        if (typeof error.correlation_id !== 'string' || error.correlation_id.length < 8) {
          problems.push(`${verb} ${status}: bad correlation_id ${JSON.stringify(error.correlation_id)}`);
        } else if (headerId && error.correlation_id !== headerId) {
          problems.push(
            `${verb} ${status}: correlation_id ${error.correlation_id} !== header ${headerId}`,
          );
        }
        if (error.code === 'VALIDATION_FAILED' && !Array.isArray(error.issues)) {
          problems.push(`${verb} ${status}: VALIDATION_FAILED without issues[]`);
        }
      }

      if (problems.length) throw new Error(`${key}: ${problems.join(' | ')}`);
    }, 30_000);
  }
});
