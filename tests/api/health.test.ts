import { describe, expect, it } from '@jest/globals';
import { GET as health } from '@/app/api/v1/health/route';
import { bodyOf, call } from './helpers';

interface HealthBody {
  status: string;
  version: string;
  time: string;
  dependencies: Record<string, { status: string; latencyMs?: number; detail?: string }>;
}

describe('GET /api/v1/health', () => {
  it('answers 200 with every dependency up', async () => {
    const response = await call(health, '/api/v1/health');
    const body = await bodyOf<HealthBody>(response);
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.version).toBeTruthy();
    expect(new Date(body.time).toISOString()).toBe(body.time);
    for (const name of ['database', 'postgis', 'storage', 'redis']) {
      expect(body.dependencies[name]?.status).toBe('up');
    }
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('echoes a well-formed caller correlation id', async () => {
    const response = await call(health, '/api/v1/health', {
      headers: { 'x-correlation-id': 'jest-health-cid' },
    });
    expect(response.headers.get('x-correlation-id')).toBe('jest-health-cid');
  });

  it('mints a fresh correlation id when the supplied one is unsafe or missing', async () => {
    const unsafe = await call(health, '/api/v1/health', {
      headers: { 'x-correlation-id': 'bad id!' },
    });
    expect(unsafe.headers.get('x-correlation-id')).not.toBe('bad id!');
    expect(unsafe.headers.get('x-correlation-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    const missing = await call(health, '/api/v1/health');
    expect(missing.headers.get('x-correlation-id')).toBeTruthy();
  });
});
