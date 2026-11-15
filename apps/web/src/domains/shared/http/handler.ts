import { timingSafeEqual } from 'node:crypto';
import { HEADERS, type Permission, type Role } from '@jobbank/shared';
import type { z } from 'zod';
import { env } from '@/lib/env';
import { clientIpFrom } from '@/lib/http/client-ip';
import { resolveCorrelationId } from '@/lib/http/correlation';
import { logger, type Logger } from '@/lib/logger';
import { recordAudit, type RequestContext } from '../audit';
import {
  BadRequestError,
  DomainError,
  ForbiddenError,
  ScopeViolationError,
  UnauthenticatedError,
  ValidationError,
} from '../errors';
import { toErrorResponse, zodIssues } from '../errors/to-response';
import {
  IDEMPOTENCY_KEY_PATTERN,
  postgresIdempotencyStore,
  requestHash,
  type IdempotencyStore,
} from '../idempotency';
import { searchParamsToObject } from '../pagination';
import { hasPermission, hasRole, type Actor } from '../scope';
import { resolveActor } from './actor';
import { resolveOnBehalfActor } from './on-behalf';
import type { HandlerResult } from './responses';

type AnySchema = z.ZodType;
type Infer<S> = S extends z.ZodType ? z.infer<S> : undefined;

export interface HandlerArgs<B, Q, P> {
  request: Request;
  ctx: RequestContext;
  /** Non-null whenever `auth` is 'required' (the default). */
  actor: Actor | null;
  body: B;
  query: Q;
  params: P;
}

export interface ApiHandlerOptions<
  BS extends AnySchema | undefined,
  QS extends AnySchema | undefined,
  PS extends AnySchema | undefined,
> {
  /** Default 'required'. 'public' endpoints still receive the actor when one is signed in. */
  auth?: 'required' | 'public';
  /** Coarse role gate (any of). */
  roles?: readonly Role[];
  /** Permission gate. Ownership + branch scope are still checked in domain services. */
  permission?: Permission;
  /**
   * Allow actors who must still enrol two-factor authentication (a 2FA-required
   * role before setup). Only for the endpoints needed to finish setup or sign out.
   */
  allowTwoFactorPending?: boolean;
  body?: BS;
  query?: QS;
  params?: PS;
  /**
   * Schema the response `data` must satisfy. Use strict schemas for anything employer-facing:
   * an unexpected field fails the request instead of leaking (PRD rule 3).
   */
  output?: AnySchema;
  /** Staff may call this job seeker route for a counter-registered candidate (see on-behalf.ts). */
  onBehalf?: boolean;
  /** Require an Idempotency-Key header and replay duplicates (PRD §8). */
  idempotent?: boolean;
  maxBodyBytes?: number;
  handler: (
    args: HandlerArgs<Infer<BS>, Infer<QS>, Infer<PS>>,
  ) => Promise<HandlerResult | Response>;
}

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

class PayloadTooLargeError extends DomainError {
  constructor(limit: number) {
    super('PAYLOAD_TOO_LARGE', 413, `Request body exceeds ${Math.round(limit / 1024)} KB`);
  }
}
class UnsupportedMediaTypeError extends DomainError {
  constructor() {
    super('UNSUPPORTED_MEDIA_TYPE', 415, 'Send the request body as application/json');
  }
}
class IdempotencyError extends DomainError {}

/** Overridable for tests. */
export const handlerDeps: { idempotencyStore: IdempotencyStore } = {
  idempotencyStore: postgresIdempotencyStore,
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Keep in sync with apps/web/src/middleware.ts.
const SESSION_COOKIE_NAMES = ['jb.session_token', '__Secure-jb.session_token'];

/**
 * CSRF defence for cookie-authenticated writes.
 *
 * Browsers always send Origin on unsafe (POST/PUT/PATCH/DELETE) requests, and always
 * send Sec-Fetch-Site. Origin is the authoritative signal — a cross-site page cannot
 * forge it (it is a forbidden header name), so a request whose Origin is this app is
 * genuine however Sec-Fetch-Site classifies it. That matters for LAN access: when the
 * app is reached by its LAN IP (e.g. a phone on http://192.168.0.150:3000) while the
 * configured app URL is still http://localhost:3000, Chrome can report
 * Sec-Fetch-Site: cross-site for the same-origin fetch, and blocking on that header
 * first locked every phone sign-in out with "Cross-site request blocked". So, for
 * unsafe methods:
 * - Origin present → it must be this app (same-origin or the configured app URL).
 *   A matching Origin passes even if Sec-Fetch-Site says cross-site.
 * - Origin absent and Sec-Fetch-Site: cross-site → refuse.
 * - Origin absent but Referer present → the Referer origin must be this app
 *   (covers older browsers that send no Origin on same-origin POSTs).
 * - Origin absent, Referer absent, Sec-Fetch-Site present → a browser request with
 *   its Origin stripped (proxy) or forged → refuse and log it. A page cannot
 *   suppress these headers: both are forbidden header names, so a cross-site page
 *   cannot hide that the request came from a browser.
 * - Neither Origin, Referer nor Sec-Fetch-Site → not a browser at all. The app's
 *   supported non-browser callers (in-process test harnesses, the Playwright
 *   global-setup warm-up, load-test scripts, curl) send no Origin and are allowed
 *   by design; if such a request carries a session cookie it is logged, so
 *   cookie-bearing non-browser traffic stays visible instead of silently passing.
 * The old behaviour (`if (!origin) return`) failed open for every browser request
 * that omitted Origin; this closes that hole without breaking the non-browser
 * clients above.
 */
function assertSameOrigin(request: Request, url: URL, log: Logger): void {
  if (!UNSAFE_METHODS.has(request.method)) return;
  const allowed = new Set([url.origin]);
  try {
    allowed.add(new URL(env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    // App URL not configured (some test setups): the same-origin check still applies.
  }
  const origin = request.headers.get('origin');
  if (origin) {
    if (!allowed.has(origin)) throw new ForbiddenError('Cross-site request blocked');
    return;
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    throw new ForbiddenError('Cross-site request blocked');
  }
  const referer = request.headers.get('referer');
  if (referer) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (!refererOrigin || !allowed.has(refererOrigin)) {
      throw new ForbiddenError('Cross-site request blocked');
    }
    return;
  }
  if (fetchSite) {
    log.warn('blocked browser write without origin', {
      method: request.method,
      path: url.pathname,
      fetchSite,
    });
    throw new ForbiddenError('Cross-site request blocked');
  }
  const cookie = request.headers.get('cookie') ?? '';
  if (SESSION_COOKIE_NAMES.some((name) => cookie.includes(`${name}=`))) {
    // Audit 2026-11-11 (L-13): in production an origin-less write carrying
    // a session cookie is blocked — CSRF protection must not rest on
    // browsers always sending Origin. The only production escape is the
    // explicit non-browser credential (x-internal-write-token, set via
    // INTERNAL_WRITE_TOKEN) for unattended automation. Test and development
    // keep the lenient path: test harnesses, Playwright warm-up and curl
    // send no Origin by design, and dev carries no production data.
    if (env.NODE_ENV === 'production' && !hasInternalWriteToken(request)) {
      log.warn('blocked origin-less cookie-authenticated write in production', {
        method: request.method,
        path: url.pathname,
      });
      throw new ForbiddenError('Cross-site request blocked');
    }
    log.warn('origin-less cookie-authenticated write from a non-browser client', {
      method: request.method,
      path: url.pathname,
    });
  }
}

/** Explicit non-browser credential for unattended automation (L-13). */
function hasInternalWriteToken(request: Request): boolean {
  const expected = env.INTERNAL_WRITE_TOKEN;
  if (!expected) return false;
  const presented = request.headers.get('x-internal-write-token');
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseWith<S extends AnySchema>(schema: S, value: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(zodIssues(result.error), `Invalid ${label}`);
  return result.data;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('application/json')) throw new UnsupportedMediaTypeError();
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new PayloadTooLargeError(maxBytes);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError('Request body is not valid JSON');
  }
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string>,
  cookies: string[] = [],
): Response {
  const out = new Headers(headers);
  for (const cookie of cookies) out.append('set-cookie', cookie);
  if (status === 204) return new Response(null, { status, headers: out });
  out.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers: out });
}

/**
 * The one pipeline every /api/v1 route goes through:
 * correlation id → CSRF origin check → actor → role/permission gate → params/query/body
 * validation → idempotency → handler → output contract → envelope. Any thrown error becomes
 * the PRD §8 error format; denied cross-scope access is audited.
 */
export function apiHandler<
  BS extends AnySchema | undefined = undefined,
  QS extends AnySchema | undefined = undefined,
  PS extends AnySchema | undefined = undefined,
>(options: ApiHandlerOptions<BS, QS, PS>) {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return async function route(request: Request, routeContext: RouteContext): Promise<Response> {
    const started = performance.now();
    const url = new URL(request.url);
    const correlationId = resolveCorrelationId(request.headers.get(HEADERS.correlationId));
    const log = logger.child({ correlationId });
    const baseHeaders: Record<string, string> = {
      [HEADERS.correlationId]: correlationId,
      'cache-control': 'no-store',
    };

    let actor: Actor | null = null;
    let ctx: RequestContext | null = null;
    let idempotency: { scope: string; key: string } | null = null;
    let status = 500;

    try {
      assertSameOrigin(request, url, log);
      actor = await resolveActor(request);
      ctx = {
        actor,
        system: false,
        correlationId,
        ip: clientIpFrom(request.headers),
        userAgent: request.headers.get('user-agent'),
        log: log.child({ actorId: actor?.userId }),
      };

      if ((options.auth ?? 'required') === 'required' && !actor) throw new UnauthenticatedError();
      if (actor?.twoFactorPending && !options.allowTwoFactorPending) {
        throw new ForbiddenError('Set up two-factor authentication to continue', {
          reason: 'TWO_FACTOR_SETUP_REQUIRED',
        });
      }
      // On-behalf resolution happens before the role/permission gates, so those
      // gates are checked against the resolved actor (the candidate, or the
      // synthesised employer actor) — never against the staff member's own roles.
      const onBehalfOf = options.onBehalf ? request.headers.get(HEADERS.onBehalfOf) : null;
      if (onBehalfOf && actor) {
        const staff = actor;
        actor = await resolveOnBehalfActor(staff, onBehalfOf);
        ctx.actor = actor;
        ctx.enteredBy = staff;
      }
      if (options.roles && (!actor || !hasRole(actor, ...options.roles))) {
        throw new ForbiddenError();
      }
      if (options.permission && (!actor || !hasPermission(actor, options.permission))) {
        throw new ForbiddenError();
      }

      const params = options.params
        ? parseWith(options.params, (await routeContext.params) ?? {}, 'path parameters')
        : undefined;
      const query = options.query
        ? parseWith(options.query, searchParamsToObject(url.searchParams), 'query parameters')
        : undefined;
      const rawBody = options.body ? await readJsonBody(request, maxBodyBytes) : undefined;
      const body = options.body ? parseWith(options.body, rawBody, 'request body') : undefined;

      if (options.idempotent) {
        const key = request.headers.get(HEADERS.idempotencyKey);
        if (!key) {
          throw new IdempotencyError(
            'IDEMPOTENCY_KEY_REQUIRED',
            400,
            'This request needs an Idempotency-Key header',
          );
        }
        if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
          throw new IdempotencyError(
            'IDEMPOTENCY_KEY_REQUIRED',
            400,
            'Idempotency-Key must be 8–128 letters, digits, _ or -',
          );
        }
        const scope = actor?.userId ?? 'anonymous';
        const route = `${request.method} ${url.pathname}`;
        const begin = await handlerDeps.idempotencyStore.begin(
          scope,
          key,
          route,
          requestHash(request.method, url.pathname, rawBody),
        );
        if (begin.state === 'mismatch') {
          throw new IdempotencyError(
            'IDEMPOTENCY_CONFLICT',
            422,
            'This Idempotency-Key was already used for a different request',
          );
        }
        if (begin.state === 'in_progress') {
          throw new IdempotencyError(
            'IDEMPOTENCY_IN_PROGRESS',
            409,
            'The original request is still being processed',
          );
        }
        if (begin.state === 'replay') {
          status = begin.status;
          return json(begin.status, begin.body, {
            ...baseHeaders,
            [HEADERS.idempotentReplay]: 'true',
          });
        }
        idempotency = { scope, key };
      }

      const result = await options.handler({
        request,
        ctx,
        actor,
        body,
        query,
        params,
      } as HandlerArgs<Infer<BS>, Infer<QS>, Infer<PS>>);

      if (result instanceof Response) {
        if (idempotency) {
          throw new Error('Idempotent handlers must return a HandlerResult, not a raw Response');
        }
        status = result.status;
        result.headers.set(HEADERS.correlationId, correlationId);
        // API responses are per-request; a route may opt into caching by setting its own header.
        if (!result.headers.has('cache-control')) result.headers.set('cache-control', 'no-store');
        return result;
      }

      if (options.output && result.data !== undefined) {
        const checked = options.output.safeParse(result.data);
        if (!checked.success) {
          log.error('response failed its output contract', {
            route: url.pathname,
            issues: zodIssues(checked.error),
          });
          throw new Error('Response failed its output contract');
        }
        result.data = checked.data;
      }

      const envelope =
        result.status === 204
          ? null
          : { data: result.data, ...(result.meta ? { meta: result.meta } : {}) };
      if (idempotency) {
        await handlerDeps.idempotencyStore.complete(
          idempotency.scope,
          idempotency.key,
          result.status,
          envelope,
        );
      }
      idempotency = null;
      status = result.status;
      return json(result.status, envelope, { ...baseHeaders, ...result.headers }, result.cookies);
    } catch (error) {
      if (idempotency) {
        await handlerDeps.idempotencyStore
          .release(idempotency.scope, idempotency.key)
          .catch((err: unknown) => log.error('failed to release idempotency key', { err }));
      }
      if (error instanceof ScopeViolationError && ctx) {
        // PRD: a denied cross-scope access attempt is itself an auditable event.
        await recordAudit(ctx, {
          action: 'access.scope_violation',
          entityType: error.target?.entityType ?? 'unknown',
          entityId: error.target?.entityId ?? null,
          branchId: error.target?.branchId ?? null,
          metadata: { method: request.method, path: url.pathname },
        }).catch((err: unknown) => log.error('failed to audit scope violation', { err }));
      }
      const mapped = toErrorResponse(error, correlationId);
      status = mapped.status;
      if (mapped.unexpected) {
        log.error('unhandled error', { method: request.method, path: url.pathname, err: error });
      }
      return json(mapped.status, mapped.body, { ...baseHeaders, ...mapped.headers });
    } finally {
      log.info('request', {
        method: request.method,
        path: url.pathname,
        status,
        durationMs: Math.round(performance.now() - started),
        actorId: actor?.userId,
      });
    }
  };
}
