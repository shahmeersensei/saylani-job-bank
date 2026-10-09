import { describe, expect, it } from '@jest/globals';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { bodyOf, call, errorOf } from './helpers';

describe('request validation pipeline', () => {
  it('answers 422 with field issues for an empty body', async () => {
    const response = await call(login, '/api/v1/auth/login', { body: {} });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(error.issues)).toBe(true);
    expect((error.issues as unknown[]).length).toBeGreaterThan(0);
    const paths = (error.issues as Array<{ path: string }>).map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('answers 422 when a field has the wrong type', async () => {
    const response = await call(login, '/api/v1/auth/login', {
      body: { email: 12345, password: true },
    });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    const paths = (error.issues as Array<{ path: string }>).map((issue) => issue.path);
    expect(paths).toContain('email');
  });

  it('answers 400 for malformed JSON', async () => {
    const response = await call(login, '/api/v1/auth/login', { raw: '{"email": ' });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe('BAD_REQUEST');
    expect(error.message).toContain('not valid JSON');
  });

  it('answers 415 when the body is not application/json', async () => {
    const response = await call(login, '/api/v1/auth/login', {
      raw: 'email=a@b.com',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(response.status).toBe(415);
    expect((await errorOf(response)).code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('answers 413 when the body exceeds 1 MB', async () => {
    const oversized = `{"password":"${'x'.repeat(1024 * 1024)}"}`;
    const response = await call(login, '/api/v1/auth/login', { raw: oversized });
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('always answers with the PRD error envelope and a correlation header', async () => {
    const response = await call(login, '/api/v1/auth/login', { body: {} });
    const body = await bodyOf<Record<string, { correlation_id: string }>>(response);
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.correlation_id).toBeTruthy();
    expect(response.headers.get('x-correlation-id')).toBe(body.error.correlation_id);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
