/**
 * Helpers for the Jest backend suite: routes are invoked in-process exactly the way
 * Next.js invokes them, so no HTTP server or browser is needed.
 */
import { POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { POST as otpRequestRoute } from '@/app/api/v1/auth/otp/request/route';
import { POST as otpVerifyRoute } from '@/app/api/v1/auth/otp/verify/route';
import { normalizePkMobile } from '@/lib/format/phone';
import { getRedis } from '@/lib/redis/client';
import { devOutbox } from '@/lib/sms/sms';

export const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
export const DEV_PASSWORD = 'JobBank-Dev-2026!';
/** Seeded phone sign-in account (Ahmed Applicant). */
export const SEEDED_APPLICANT_PHONE = '3001234567';

const RL_PREFIX = process.env.RATE_LIMIT_PREFIX ?? 'rl';

export type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

export type RouteHandler = (request: Request, context: RouteContext) => Promise<Response>;

export interface CallOptions {
  method?: string;
  /** JSON-serialised as the request body (unless `raw` is given). */
  body?: unknown;
  /** Raw request text, bypassing JSON.stringify (malformed-JSON tests). */
  raw?: string;
  headers?: Record<string, string>;
  jar?: Jar;
  params?: Record<string, string>;
}

/** Calls a route handler with a fabricated Request (no server involved). */
export async function call(
  handler: RouteHandler,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if ((options.body !== undefined || options.raw !== undefined) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (options.jar) {
    const cookie = options.jar.header();
    if (cookie) headers.set('cookie', cookie);
  }
  const text = options.raw !== undefined ? options.raw : JSON.stringify(options.body ?? undefined);
  const request = new Request(`${BASE}${path}`, {
    method:
      options.method ?? (options.body === undefined && options.raw === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined && options.raw === undefined ? undefined : text,
  });
  return handler(request, { params: Promise.resolve(options.params ?? {}) });
}

/** Minimal cookie jar for round-tripping session cookies between calls. */
export class Jar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): this {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return this;
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlation_id: string;
    issues?: unknown[];
    details?: { reason?: string; retryAfterSeconds?: number };
  };
}

/** Awaits a response body as JSON and returns it typed. */
export async function bodyOf<T = unknown>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function errorOf(response: Response): Promise<ErrorBody['error']> {
  return (await bodyOf<ErrorBody>(response)).error;
}

/** Deletes Redis rate-limit counters (`rl:<name>:<subject>`) so reruns start clean. */
export async function clearRateLimits(
  ...pairs: Array<[name: string, subject: string]>
): Promise<void> {
  const redis = getRedis();
  if (!redis || pairs.length === 0) return;
  await redis.del(...pairs.map(([name, subject]) => `${RL_PREFIX}:${name}:${subject}`));
}

export interface SignInSuccess {
  jar: Jar;
  status: number;
  data: { kind: string; roles: string[]; homePath: string };
}

/** Password sign-in with the rate limiter reset first; throws unless signed in. */
export async function signIn(
  email: string,
  password: string = DEV_PASSWORD,
  jar: Jar = new Jar(),
): Promise<SignInSuccess> {
  await clearRateLimits(['login-email', email.trim().toLowerCase()]);
  const response = await call(loginRoute, '/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    jar,
  });
  const body = await bodyOf<{ data?: SignInSuccess['data']; error?: unknown }>(response);
  jar.absorb(response);
  const data = body.data;
  if (response.status !== 200 || data?.kind !== 'signed_in') {
    throw new Error(`sign-in failed for ${email}: ${response.status} ${JSON.stringify(body)}`);
  }
  return { jar, status: response.status, data };
}

/** Reads the newest 6-digit code sent to `phone` out of the in-process SMS outbox. */
export function latestOtpCode(phone: string): string {
  const canonical = normalizePkMobile(phone) ?? phone;
  const entry = [...devOutbox]
    .reverse()
    .find((message) => message.to === canonical || message.to === phone);
  if (!entry) throw new Error(`no SMS was sent to ${phone}`);
  const match = entry.message.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`SMS for ${phone} contains no 6-digit code: ${entry.message}`);
  return match[1];
}

export { loginRoute, otpRequestRoute, otpVerifyRoute };
