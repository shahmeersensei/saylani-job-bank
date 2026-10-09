import { describe, expect, it } from '@jest/globals';
import { GET as branches } from '@/app/api/v1/branches/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { DEV_PASSWORD, bodyOf, call, clearRateLimits, errorOf, signIn } from './helpers';

describe('RBAC on GET /api/v1/branches', () => {
  it('rejects anonymous callers with 401', async () => {
    const response = await call(branches, '/api/v1/branches');
    expect(response.status).toBe(401);
    expect((await errorOf(response)).code).toBe('UNAUTHENTICATED');
  });

  it('lets a STAFF user read branches', async () => {
    const { jar } = await signIn('staff.khi@jobbank.local');
    const response = await call(branches, '/api/v1/branches', { jar });
    expect(response.status).toBe(200);
    const body = await bodyOf<{ data: unknown }>(response);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('blocks a Super Admin who has not enrolled 2FA yet', async () => {
    const { jar } = await signIn('superadmin@jobbank.local');
    const response = await call(branches, '/api/v1/branches', { jar });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details?.reason).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect(error.message).toContain('two-factor');
  });

  it('refuses an EMPLOYER (no branch:read permission)', async () => {
    const { jar } = await signIn('employer@jobbank.local');
    const response = await call(branches, '/api/v1/branches', { jar });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details?.reason).toBeUndefined();
  });
});

describe('blocked account', () => {
  it('reveals the disabled state only after the right password', async () => {
    const email = 'disabled.staff@jobbank.local';
    await clearRateLimits(['login-email', email]);
    const wrong = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'definitely-wrong' },
    });
    expect(wrong.status).toBe(401);
    expect((await errorOf(wrong)).message).toBe('Incorrect email or password');

    await clearRateLimits(['login-email', email]);
    const right = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: DEV_PASSWORD },
    });
    expect(right.status).toBe(403);
    const error = await errorOf(right);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.details?.reason).toBe('ACCOUNT_DISABLED');
  });
});
