import { describe, expect, it } from 'vitest';
import { HealthResponse } from '@agent-band/contracts';
import { buildApp } from './app.ts';

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.parse(res.json())).toEqual({ status: 'ok' });
    await app.close();
  });
});
