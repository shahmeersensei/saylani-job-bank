import { describe, expect, it } from '@jest/globals';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { call, errorOf } from './helpers';

const SAFE_ORIGIN = 'http://localhost:3000';

describe('CSRF origin guard on unsafe methods', () => {
  it('blocks a cross-site Origin header', async () => {
    const response = await call(logout, '/api/v1/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    const error = await errorOf(response);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).toContain('Cross-site');
  });

  it('blocks requests flagged sec-fetch-site: cross-site', async () => {
    const response = await call(login, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'a@b.com', password: 'x' },
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(response.status).toBe(403);
    expect((await errorOf(response)).message).toContain('Cross-site');
  });

  it('accepts the same origin', async () => {
    const response = await call(logout, '/api/v1/auth/logout', {
      method: 'POST',
      headers: { origin: SAFE_ORIGIN },
    });
    expect(response.status).toBe(204);
  });

  it('accepts non-browser clients that send no Origin header', async () => {
    const response = await call(logout, '/api/v1/auth/logout', { method: 'POST' });
    expect(response.status).toBe(204);
  });

  it('never applies the guard to safe methods', async () => {
    const { GET: me } = await import('@/app/api/v1/auth/me/route');
    const response = await call(me, '/api/v1/auth/me', {
      headers: { origin: 'https://evil.example' },
    });
    // 401 (no session) rather than 403: GET requests skip the origin check.
    expect(response.status).toBe(401);
  });
});
