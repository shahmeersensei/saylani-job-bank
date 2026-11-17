'use client';

import type { ApiError, FieldIssue, PaginationMeta } from '@jobbank/shared';

/** Error thrown by apiFetch for any non-2xx response, carrying the PRD §8 error envelope. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiError['error']['code'] | 'NETWORK';
  readonly issues: FieldIssue[];
  readonly details: unknown;
  readonly correlationId: string | undefined;

  constructor(
    status: number,
    body: ApiError | null,
    fallback = 'Something went wrong. Please try again.',
  ) {
    super(body?.error.message ?? fallback);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body?.error.code ?? 'NETWORK';
    this.issues = body?.error.issues ?? [];
    this.details = body?.error.details;
    this.correlationId = body?.error.correlation_id;
  }

  /** Message for one form field, if the server reported one. */
  issueFor(path: string): string | undefined {
    return this.issues.find((issue) => issue.path === path)?.message;
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Pass for idempotent writes; reuse the same key when retrying the same action. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Staff at a counter acting for this candidate. */
  onBehalfOf?: string;
}

let onBehalfOf: string | null = null;

/** While a counter screen is open, job seeker API calls are made for this candidate. */
export function setApiOnBehalfOf(applicantId: string | null): void {
  onBehalfOf = applicantId;
}

/** Same-origin JSON client for /api/v1. Returns the `data` (and `meta`) of the envelope. */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const candidate = options.onBehalfOf ?? onBehalfOf;
  if (candidate) headers['x-jb-on-behalf-of'] = candidate;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch {
    throw new ApiClientError(0, null, 'Cannot reach the server. Check your internet connection.');
  }

  if (response.status === 204) return { data: undefined as T };
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiClientError(response.status, json as ApiError | null);
  return json as { data: T; meta?: PaginationMeta };
}

/** "items.0.skillCode" → "items #1 › skill code"; "salaryMin" → "salary min". */
export function humanizePath(path: string): string {
  return path
    .split('.')
    .map((segment) =>
      /^\d+$/.test(segment)
        ? `#${Number(segment) + 1}`
        : segment
            .replace(/([A-Z])/g, ' $1')
            .trim()
            .toLowerCase(),
    )
    .join(' › ');
}

/**
 * One shared error message for forms (H15): a 422 arrives with per-field `issues`,
 * but callers that showed only `err.message` rendered the useless "Invalid request
 * body". With issues, list them field by field (at most five, then a count);
 * without issues, fall back to the message. Renders on one line — the forms show
 * it in a single <p>.
 */
export function friendlyApiError(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.issues.length > 0) {
      const parts = err.issues.map((issue) =>
        issue.path === '(root)' ? issue.message : `${humanizePath(issue.path)}: ${issue.message}`,
      );
      const unique = [...new Set(parts)];
      const shown = unique.slice(0, 5);
      const extra = unique.length - shown.length;
      return shown.join(' · ') + (extra > 0 ? ` · (+${extra} more)` : '');
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

/** How an API failure should be shown: a validation list, a network problem, or a system error. */
export type ApiErrorKind = 'validation' | 'system' | 'network';

export interface ApiErrorDescription {
  kind: ApiErrorKind;
  /** Short heading, e.g. "Please fix these 2 fields" or "Create account failed". */
  title: string;
  /** Full message: per-field issues for validation, otherwise the server message. */
  message: string;
  issues: FieldIssue[];
  code: string;
  status: number;
  correlationId: string | undefined;
}

/**
 * Turns any thrown value into one structured description for the UI, so
 * callers never have to pick between `err.message` (which hides the
 * per-field issues) and the issues (which hide the code / correlation id).
 * - 422 with issues → `validation`: list the fields, each with its fix.
 * - status 0 / NETWORK → `network`: the server could not be reached.
 * - anything else → `system`: what happened, plus code/status/correlation
 *   id so a developer can trace it in the server log. Never includes a
 *   stack trace or any other internal detail.
 */
export function describeApiError(err: unknown, operation?: string): ApiErrorDescription {
  const title = operation ? `${operation} failed` : 'Request failed';
  if (err instanceof ApiClientError) {
    if (err.status === 0 || err.code === 'NETWORK') {
      return {
        kind: 'network',
        title,
        message: 'Cannot reach the server. Check your internet connection and try again.',
        issues: [],
        code: 'NETWORK',
        status: 0,
        correlationId: err.correlationId,
      };
    }
    if (err.issues.length > 0) {
      return {
        kind: 'validation',
        title:
          err.issues.length === 1
            ? 'Please fix this field'
            : `Please fix these ${err.issues.length} fields`,
        message: friendlyApiError(err),
        issues: err.issues,
        code: err.code,
        status: err.status,
        correlationId: err.correlationId,
      };
    }
    return {
      kind: 'system',
      title,
      message: err.message,
      issues: [],
      code: err.code,
      status: err.status,
      correlationId: err.correlationId,
    };
  }
  if (typeof err === 'string' && err) {
    return {
      kind: 'system',
      title,
      message: err,
      issues: [],
      code: 'CLIENT_ERROR',
      status: 0,
      correlationId: undefined,
    };
  }
  if (err instanceof Error) {
    return {
      kind: 'system',
      title,
      message: err.message,
      issues: [],
      code: 'CLIENT_ERROR',
      status: 0,
      correlationId: undefined,
    };
  }
  return {
    kind: 'system',
    title,
    message: 'Something went wrong. Please try again.',
    issues: [],
    code: 'UNKNOWN',
    status: 0,
    correlationId: undefined,
  };
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return null;
  return next;
}
