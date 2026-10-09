import { describe, expect, it } from '@jest/globals';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { Jar, bodyOf, call, errorOf, signIn } from './helpers';

describe('session lifecycle', () => {
  it('refuses /auth/me without a session', async () => {
    const response = await call(me, '/api/v1/auth/me');
    expect(response.status).toBe(401);
    const error = await errorOf(response);
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.correlation_id).toBeTruthy();
  });

  it('signs staff in, describes the session, then signs out', async () => {
    const { jar, data } = await signIn('staff.khi@jobbank.local');
    expect(data.kind).toBe('signed_in');
    expect(data.roles).toContain('STAFF');
    expect(data.homePath).toBe('/staff');

    const who = await call(me, '/api/v1/auth/me', { jar });
    expect(who.status).toBe(200);
    const session = await bodyOf<{ data: { user?: { id?: string }; roles?: string[] } }>(who);
    expect(session.data).toBeDefined();
    expect(session.data.roles).toContain('STAFF');

    const out = await call(logout, '/api/v1/auth/logout', { method: 'POST', jar });
    expect(out.status).toBe(204);
    jar.absorb(out);

    const after = await call(me, '/api/v1/auth/me', { jar });
    expect(after.status).toBe(401);
  });

  it('logout is safe to call while already signed out', async () => {
    const response = await call(logout, '/api/v1/auth/logout', { method: 'POST', jar: new Jar() });
    expect(response.status).toBe(204);
  });
});
