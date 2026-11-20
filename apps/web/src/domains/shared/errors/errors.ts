import { fieldLabel, messageNamesField, type ErrorCode, type FieldIssue } from '@jobbank/shared';

export { fieldLabel };

/**
 * Base class for expected, user-facing failures. Anything that is NOT a DomainError
 * is treated as a bug: logged with its stack and returned as a generic 500.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class BadRequestError extends DomainError {
  constructor(
    message = 'The request could not be understood — check the data you sent and try again.',
    details?: unknown,
  ) {
    super('BAD_REQUEST', 400, message, details);
  }
}

/**
 * Top-level message for a validation failure. Every issue is named, not
 * only the first, so a person sees each field and the reason it failed.
 * A message that already starts with the field label is not prefixed again.
 */
export function validationMessage(issues: FieldIssue[]): string {
  if (issues.length === 0) return 'Some fields are invalid';
  const parts = issues.map((issue) => {
    if (issue.path === '(root)' || issue.path === 'root' || issue.path === '') return issue.message;
    if (messageNamesField(issue.path, issue.message)) return issue.message;
    return `${fieldLabel(issue.path)}: ${issue.message}`;
  });
  return [...new Set(parts)].join('; ');
}

export class ValidationError extends DomainError {
  readonly issues: FieldIssue[];
  constructor(issues: FieldIssue[], message?: string) {
    super('VALIDATION_FAILED', 422, message ?? validationMessage(issues));
    this.issues = issues;
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Sign in to continue') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do this', details?: unknown) {
    super('FORBIDDEN', 403, message, details);
  }
}

export interface ScopeTarget {
  entityType: string;
  entityId?: string;
  branchId?: string | null;
}

/** The actor has the right role, but the record belongs to another branch/company/applicant. */
export class ScopeViolationError extends DomainError {
  /** What was being accessed — recorded in the audit log, never sent to the client. */
  readonly target?: ScopeTarget;
  constructor(message = 'This record is outside your access scope', target?: ScopeTarget) {
    super('SCOPE_VIOLATION', 403, message);
    this.target = target;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', 404, id ? `${entity} ${id} was not found` : `${entity} was not found`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', 409, message, details);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(machine: string, from: string, event: string, reason?: string) {
    super(
      'INVALID_TRANSITION',
      409,
      reason ??
        `Cannot ${event.toLowerCase().replace(/_/g, ' ')} a ${machine} that is ${from.toLowerCase().replace(/_/g, ' ')}`,
      { machine, from, event },
    );
  }
}

export class RateLimitedError extends DomainError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'Too many requests. Please try again later.') {
    super('RATE_LIMITED', 429, message, { retryAfterSeconds });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * True when `error` (or a wrapped cause, e.g. drizzle's query error) is a Postgres
 * unique-constraint violation — optionally on one named constraint. Use it to turn the race
 * a pre-check cannot close (two requests inserting the same value) into a ConflictError.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const pg = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (pg.code === '23505') return constraint === undefined || pg.constraint_name === constraint;
    current = pg.cause;
  }
  return false;
}

/**
 * True when `error` (or a wrapped cause) is a Postgres check-constraint
 * violation — optionally on one named constraint. Use it to turn a DB
 * backstop (e.g. a race between a pre-check and the write) into a
 * ValidationError on the offending field instead of an unhandled 500.
 */
export function isCheckViolation(error: unknown, constraint?: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const pg = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (pg.code === '23514') return constraint === undefined || pg.constraint_name === constraint;
    current = pg.cause;
  }
  return false;
}
