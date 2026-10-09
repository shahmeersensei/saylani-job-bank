import { expect, test } from '@playwright/test';

test.describe('API health', () => {
  test('GET /api/v1/health reports every dependency up', async ({ request }) => {
    const response = await request.get('/api/v1/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.dependencies.database.status).toBe('up');
    expect(body.dependencies.postgis.status).toBe('up');
    expect(body.dependencies.storage.status).toBe('up');
    expect(body.dependencies.redis.status).toBe('up');
    expect(response.headers()['x-correlation-id']).toBeTruthy();
  });

  test('protected API routes answer with the standard error envelope', async ({ request }) => {
    const response = await request.get('/api/v1/branches');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.correlation_id).toBeTruthy();
    expect(response.headers()['x-correlation-id']).toBe(body.error.correlation_id);
  });
});
