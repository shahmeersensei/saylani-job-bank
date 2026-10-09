import { describe, expect, it } from '@jest/globals';
import { GET as health } from '@/app/api/v1/health/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { bodyOf, call, errorOf } from './helpers';

describe('smoke: the Jest harness can load and call route handlers', () => {
  it('GET /api/v1/health answers 200 with all dependencies up', async () => {
    const response = await call(health, '/api/v1/health');
    expect(response.status).toBe(200);
    const body = await bodyOf<{ status: string; dependencies: Record<string, { status: string }> }>(
      response,
    );
    expect(body.status).toBe('ok');
    expect(body.dependencies.database.status).toBe('up');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('POST /api/v1/auth/login rejects malformed bodies with the error envelope', async () => {
    const response = await call(login, '/api/v1/auth/login', { body: {} });
    expect(response.status).toBe(422);
    const error = await errorOf(response);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.correlation_id).toBeTruthy();
  });
});
