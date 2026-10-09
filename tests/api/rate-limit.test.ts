import { describe, expect, it } from '@jest/globals';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { call, bodyOf } from './helpers';

describe('login rate limiting', () => {
  it('answers 429 with Retry-After after 30 attempts from one IP in 15 minutes', async () => {
    const ip = `jest-rl-${Date.now()}`;
    const statuses: number[] = [];
    let last: Response | undefined;

    for (let attempt = 0; attempt < 31; attempt += 1) {
      last = await call(login, '/api/v1/auth/login', {
        method: 'POST',
        // Unique emails keep the per-email limiter out of the way; the IP counter is the target.
        body: { email: `rl-${ip}-${attempt}@jest.invalid`, password: 'wrong-password' },
        headers: { 'x-forwarded-for': ip },
      });
      statuses.push(last.status);
    }

    expect(statuses.slice(0, 30)).toEqual(Array(30).fill(401));
    expect(statuses[30]).toBe(429);

    const body = await bodyOf<{
      error: { code: string; details?: { retryAfterSeconds?: number } };
    }>(last!);
    expect(Object.keys(body)).toEqual(['error']);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(last!.headers.get('retry-after')).toBe(String(body.error.details?.retryAfterSeconds));
  }, 180_000);
});
