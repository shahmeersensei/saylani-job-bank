import { CHECK_CONSTRAINT_MESSAGES } from '@jobbank/db/check-messages';
import { fieldLabel, type ApiError, type ErrorCode, type FieldIssue } from '@jobbank/shared';
import { ZodError } from 'zod';
import { DomainError, RateLimitedError, ValidationError, validationMessage } from './errors';

export interface ErrorResponse {
  status: number;
  body: ApiError;
  headers?: Record<string, string>;
  /** True for unexpected errors that must be logged with a stack trace. */
  unexpected: boolean;
}

export function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

/** Postgres SQLSTATEs we translate into meaningful API errors. */
const PG_ERRORS: Record<string, { code: ErrorCode; status: number }> = {
  '23505': { code: 'CONFLICT', status: 409 },
  '23503': { code: 'CONFLICT', status: 409 },
  '23514': { code: 'VALIDATION_FAILED', status: 422 },
  /** NOT NULL — a required column was omitted. */
  '23502': { code: 'VALIDATION_FAILED', status: 422 },
  /** Numeric value out of range (e.g. a salary that overflows Postgres `integer`) — S1. */
  '22003': { code: 'VALIDATION_FAILED', status: 422 },
  JB001: { code: 'APPEND_ONLY_VIOLATION', status: 409 },
};

function pgCode(error: unknown): string | undefined {
  // drizzle wraps driver errors; the SQLSTATE lives on the error or its cause.
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

type PgShape = {
  column?: unknown;
  column_name?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  detail?: unknown;
  message?: unknown;
  cause?: unknown;
};

function walkPg(error: unknown): PgShape[] {
  const chain: PgShape[] = [];
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    chain.push(current as PgShape);
    current = (current as PgShape).cause;
  }
  return chain;
}

/** Column name only — never the value sitting next to it in `detail`. */
function pgColumn(error: unknown): string | undefined {
  for (const current of walkPg(error)) {
    const named = current.column ?? current.column_name;
    if (typeof named === 'string' && named) return named;
    if (typeof current.detail === 'string') {
      const match = /Key \(([^)]+)\)/.exec(current.detail);
      const column = match?.[1]?.split(',')[0]?.trim().replace(/"/g, '');
      if (column) return column;
    }
    if (typeof current.message === 'string') {
      const match = /column "([^"]+)"/.exec(current.message);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

function pgConstraint(error: unknown): string | undefined {
  for (const current of walkPg(error)) {
    const name = current.constraint ?? current.constraint_name;
    if (typeof name === 'string' && name) return name;
  }
  return undefined;
}

/** Last snake_case word of a constraint, as a field label. */
function labelFromConstraint(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const stripped = name.replace(/_(format|valid|positive|range|max|floor|check|order|object)$/, '');
  const leaf = stripped.split('_').pop();
  if (!leaf || leaf.length < 2) return undefined;
  return fieldLabel(leaf);
}

function checkMessage(error: unknown, column: string | undefined): string {
  const constraint = pgConstraint(error);
  if (constraint && CHECK_CONSTRAINT_MESSAGES[constraint])
    return CHECK_CONSTRAINT_MESSAGES[constraint];
  const label = column ? fieldLabel(column) : labelFromConstraint(constraint);
  if (!label) return 'A value is not allowed. Check the form and try again.';
  if (constraint?.endsWith('_format')) return `${label} is not in the right format.`;
  if (constraint?.endsWith('_positive') || constraint?.endsWith('_floor')) {
    return `${label} must be greater than zero.`;
  }
  if (constraint?.endsWith('_range') || constraint?.endsWith('_max')) {
    return `${label} is outside the allowed range.`;
  }
  if (constraint?.endsWith('_valid')) return `${label} is not an allowed value.`;
  return `${label} is not allowed.`;
}

/** Message for a mapped Postgres error. Values from the row are never copied in. */
export function pgMessage(code: string, error: unknown): string {
  const column = pgColumn(error);
  const field = column ? fieldLabel(column).toLowerCase() : undefined;
  switch (code) {
    case '23505':
      return field
        ? `A record with this ${field} already exists — use a different ${field}, or open the existing record.`
        : 'A record with these details already exists — use different details, or open the existing record.';
    case '23503':
      return field
        ? `The ${field} you selected does not exist — choose an existing ${field} and try again.`
        : 'A related record does not exist or is still in use — check it still exists and try again.';
    case '23514':
      return checkMessage(error, column);
    case '23502':
      return column ? `${fieldLabel(column)} is required.` : 'A required field was left empty.';
    case '22003':
      return column
        ? `${fieldLabel(column)} is outside the allowed range.`
        : 'A number is too large — reduce it to fit the allowed range and try again.';
    case 'JB001':
      return 'This record is permanent and cannot be changed';
    default:
      return column
        ? `${fieldLabel(column)} was rejected. Check it and try again.`
        : 'The database rejected this change — check the highlighted fields and try again.';
  }
}

/** Maps any thrown value to the PRD §8 error envelope. Never leaks internals for 5xx. */
export function toErrorResponse(error: unknown, correlationId: string): ErrorResponse {
  const envelope = (
    code: ErrorCode,
    message: string,
    extra: Partial<ApiError['error']> = {},
  ): ApiError => ({
    error: { code, message, ...extra, correlation_id: correlationId },
  });

  if (error instanceof ValidationError) {
    return {
      status: 422,
      body: envelope(error.code, error.message, { issues: error.issues }),
      unexpected: false,
    };
  }
  if (error instanceof ZodError) {
    const issues = zodIssues(error);
    return {
      status: 422,
      body: envelope('VALIDATION_FAILED', validationMessage(issues), { issues }),
      unexpected: false,
    };
  }
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: envelope(
        error.code,
        error.message,
        error.details !== undefined ? { details: error.details } : {},
      ),
      headers:
        error instanceof RateLimitedError
          ? { 'retry-after': String(error.retryAfterSeconds) }
          : undefined,
      unexpected: false,
    };
  }

  const mapped = pgCode(error);
  if (mapped && PG_ERRORS[mapped]) {
    const { code, status } = PG_ERRORS[mapped];
    return { status, body: envelope(code, pgMessage(mapped, error)), unexpected: false };
  }

  return {
    status: 500,
    body: envelope('INTERNAL', 'Something went wrong on our side. Please try again.'),
    unexpected: true,
  };
}
