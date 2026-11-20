import { describe, expect, it } from 'vitest';
import { ApiClientError, describeApiError, friendlyApiError } from './client';

const validationErr = new ApiClientError(422, {
  error: {
    code: 'VALIDATION_FAILED',
    message: 'Password: Use at least 10 characters, including a letter and a number.',
    issues: [
      { path: 'password', message: 'Use at least 10 characters, including a letter and a number.' },
    ],
    correlation_id: 'corr-9',
  },
});

describe('describeApiError', () => {
  it('describes a 422 as validation, with the field issue and no system reference', () => {
    const described = describeApiError(validationErr, 'Create account');
    expect(described.kind).toBe('validation');
    expect(described.title).toBe('Please fix this field');
    expect(described.message).toContain(
      'password: Use at least 10 characters, including a letter and a number.',
    );
    expect(described.message).toContain('Use at least 10 characters');
    expect(described.issues).toHaveLength(1);
    expect(described.correlationId).toBe('corr-9');
  });

  it('describes a 500 as a system error with code, status and correlation id', () => {
    const err = new ApiClientError(500, {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Please try again.',
        correlation_id: 'corr-abc',
      },
    });
    const described = describeApiError(err, 'Save job');
    expect(described.kind).toBe('system');
    expect(described.title).toBe('Save job failed');
    expect(described.code).toBe('INTERNAL');
    expect(described.status).toBe(500);
    expect(described.correlationId).toBe('corr-abc');
  });

  it('describes a network failure with what to do next', () => {
    const described = describeApiError(new ApiClientError(0, null), 'Sign in');
    expect(described.kind).toBe('network');
    expect(described.title).toBe('Sign in failed');
    expect(described.message).toContain('Cannot reach the server');
    expect(described.message).toContain('internet connection');
  });

  it('describes a plain error and an unknown value without inventing detail', () => {
    expect(describeApiError(new Error('boom')).message).toBe('boom');
    expect(describeApiError('nope').message).toBe('nope');
    expect(describeApiError(undefined).message).toBe('Something went wrong. Please try again.');
  });
});

describe('friendlyApiError (H15)', () => {
  it('lists field issues instead of the generic "Invalid request body"', () => {
    const err = new ApiClientError(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request body',
        issues: [
          { path: 'salaryMin', message: 'Must be less than salary max' },
          { path: 'items.0.skillCode', message: 'Choose an option from the list' },
        ],
        correlation_id: 'x',
      },
    });
    expect(friendlyApiError(err)).toBe(
      'salary min: Must be less than salary max · items › #1 › skill code: Choose an option from the list',
    );
  });

  it('falls back to the message when there are no issues', () => {
    const err = new ApiClientError(500, {
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side.',
        correlation_id: 'x',
      },
    });
    expect(friendlyApiError(err)).toBe('Something went wrong on our side. Reference: x.');
    expect(friendlyApiError(new ApiClientError(0, null))).toBe(
      'Something went wrong. Please try again.',
    );
    expect(friendlyApiError(new Error('boom'))).toBe('boom');
    expect(friendlyApiError('nope')).toBe('Something went wrong. Please try again.');
  });

  it('caps long issue lists with a count', () => {
    const issues = Array.from({ length: 7 }, (_, i) => ({ path: `f${i}`, message: 'bad' }));
    const err = new ApiClientError(422, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid request body',
        issues,
        correlation_id: 'x',
      },
    });
    expect(friendlyApiError(err)).toContain('(+2 more)');
  });
});
