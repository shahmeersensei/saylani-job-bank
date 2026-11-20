import { apiErrorSchema } from '@jobbank/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  RateLimitedError,
  ScopeViolationError,
  UnauthenticatedError,
  ValidationError,
} from './errors';
import { toErrorResponse } from './to-response';

const CID = 'corr-12345678';

describe('toErrorResponse', () => {
  it.each([
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new ScopeViolationError(), 403, 'SCOPE_VIOLATION'],
    [new NotFoundError('Company', 'c-1'), 404, 'NOT_FOUND'],
    [new ConflictError('Already verified'), 409, 'CONFLICT'],
    [new InvalidTransitionError('company', 'VERIFIED', 'VERIFY'), 409, 'INVALID_TRANSITION'],
  ])('maps %s', (error, status, code) => {
    const res = toErrorResponse(error, CID);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.error.correlation_id).toBe(CID);
    expect(res.unexpected).toBe(false);
    expect(apiErrorSchema.parse(res.body)).toEqual(res.body);
  });

  it('writes a readable message for invalid transitions', () => {
    expect(new InvalidTransitionError('company', 'VERIFIED', 'REQUEST_INFO').message).toBe(
      'Cannot request info a company that is verified',
    );
  });

  it('includes field issues for validation errors (domain and zod)', () => {
    const domain = toErrorResponse(
      new ValidationError([{ path: 'cnic', message: 'Invalid CNIC' }]),
      CID,
    );
    expect(domain.status).toBe(422);
    expect(domain.body.error.issues).toEqual([{ path: 'cnic', message: 'Invalid CNIC' }]);

    const parsed = z.object({ age: z.number().min(18) }).safeParse({ age: 12 });
    const zod = toErrorResponse(parsed.error, CID);
    expect(zod.status).toBe(422);
    expect(zod.body.error.issues?.[0]?.path).toBe('age');
  });

  it('derives the validation message from the issues, never the generic default', () => {
    // The 2026-11-12 signup bug: one issue, the password message, was hidden
    // behind "Some fields are invalid".
    const single = toErrorResponse(
      new ValidationError([
        {
          path: 'password',
          message: 'Use at least 10 characters, including a letter and a number.',
        },
      ]),
      CID,
    );
    expect(single.body.error.message).toBe(
      'Password: Use at least 10 characters, including a letter and a number.',
    );

    const multi = toErrorResponse(
      new ValidationError([
        { path: 'email', message: 'Enter a valid email' },
        { path: 'password', message: 'Use at least 8 characters' },
      ]),
      CID,
    );
    expect(multi.body.error.message).toBe(
      'Email: Enter a valid email; Password: Use at least 8 characters',
    );

    // An explicit message still wins.
    const explicit = toErrorResponse(
      new ValidationError([{ path: 'code', message: 'Wrong code' }], 'Invalid list parameters'),
      CID,
    );
    expect(explicit.body.error.message).toBe('Invalid list parameters');

    // Zod errors get the same treatment.
    const parsed = z.object({ age: z.number().min(18) }).safeParse({ age: 12 });
    const zod = toErrorResponse(parsed.error, CID);
    expect(zod.body.error.message).not.toBe('Some fields are invalid');
    expect(zod.body.error.message).toContain('Age');
    expect(zod.body.error.message).toContain('at least 18');
  });

  it('names the field for Postgres duplicate / missing-reference errors', () => {
    const duplicate = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (email)=(someone@example.com) already exists.',
    });
    const dupRes = toErrorResponse(duplicate, CID);
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.message).toContain('this email already exists');
    // The conflicting value is never echoed back.
    expect(dupRes.body.error.message).not.toContain('someone@example.com');

    const missing = Object.assign(new Error('insert or update violates foreign key'), {
      code: '23503',
      detail: 'Key (company_id)=(c-9) is not present in table "companies".',
    });
    expect(toErrorResponse(missing, CID).body.error.message).toContain(
      'The company id you selected does not exist',
    );

    // Without a detail, the generic text (with guidance) still applies.
    const bare = Object.assign(new Error('duplicate key value'), { code: '23505' });
    expect(toErrorResponse(bare, CID).body.error.message).toContain(
      'A record with these details already exists',
    );
  });

  it('names the check constraint and a missing required column', () => {
    const check = Object.assign(new Error('check violation'), {
      code: '23514',
      constraint: 'applicants_cnic_format',
      detail: 'Failing row contains (secret-cnic-value).',
    });
    const checkRes = toErrorResponse(check, CID);
    expect(checkRes.status).toBe(422);
    expect(checkRes.body.error.message).toBe('CNIC must be 13 digits with no dashes.');
    expect(checkRes.body.error.message).not.toContain('secret-cnic-value');

    const wrapped = new Error('Failed query', {
      cause: Object.assign(new Error('check'), {
        code: '23514',
        constraint_name: 'jobs_vacancies_positive',
      }),
    });
    expect(toErrorResponse(wrapped, CID).body.error.message).toBe(
      'Vacancies must be greater than zero.',
    );

    const unknown = Object.assign(new Error('check'), {
      code: '23514',
      constraint: 'widgets_colour_format',
    });
    expect(toErrorResponse(unknown, CID).body.error.message).toBe(
      'Colour is not in the right format.',
    );

    const missing = Object.assign(
      new Error(
        'null value in column "father_name" of relation "applicants" violates not-null constraint',
      ),
      { code: '23502', column: 'father_name' },
    );
    const missingRes = toErrorResponse(missing, CID);
    expect(missingRes.status).toBe(422);
    expect(missingRes.body.error.message).toBe('Father name is required.');
    expect(missingRes.body.error.message).not.toContain('applicants');
  });

  it('keeps the 500 message generic but always includes the correlation id', () => {
    const res = toErrorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'), CID);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Something went wrong on our side. Please try again.');
    expect(res.body.error.correlation_id).toBe(CID);
  });

  it('adds Retry-After for rate limits', () => {
    expect(toErrorResponse(new RateLimitedError(30), CID).headers).toEqual({ 'retry-after': '30' });
  });

  it('translates Postgres errors, including when wrapped by drizzle', () => {
    const unique = Object.assign(new Error('duplicate key value'), { code: '23505' });
    expect(toErrorResponse(unique, CID).body.error.code).toBe('CONFLICT');

    // S1: a number that overflows Postgres `integer` (e.g. salaryMin 3_000_000_000)
    // is a 422, not a raw 500.
    const overflow = Object.assign(new Error('numeric field overflow'), { code: '22003' });
    const overflowRes = toErrorResponse(overflow, CID);
    expect(overflowRes.status).toBe(422);
    expect(overflowRes.body.error.code).toBe('VALIDATION_FAILED');
    expect(overflowRes.unexpected).toBe(false);

    const wrapped = new Error('Failed query: UPDATE audit_logs', {
      cause: Object.assign(new Error('table "audit_logs" is append-only'), { code: 'JB001' }),
    });
    const res = toErrorResponse(wrapped, CID);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPEND_ONLY_VIOLATION');
  });

  it('hides internals of unexpected errors', () => {
    const res = toErrorResponse(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
      CID,
    );
    expect(res.status).toBe(500);
    expect(res.unexpected).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.5/);
  });
});
