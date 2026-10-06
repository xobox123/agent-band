import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildApp } from '../http/app.ts';
import { openTestDatabase } from './db.ts';
import { conflict, forbidden, notFound } from './errors.ts';
import { registerPlatform } from './http.ts';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

function bare(): FastifyInstance {
  const a = Fastify();
  registerPlatform(a);
  void a.register((r) => {
    const typed = r.withTypeProvider<ZodTypeProvider>();
    typed.post(
      '/echo',
      {
        schema: {
          body: z.object({ name: z.string().min(1) }),
          response: { 200: z.object({ name: z.string() }) },
        },
      },
      (req) => req.body,
    );
    r.get('/nf', () => {
      throw notFound('Task');
    });
    r.get('/forbidden', () => {
      throw forbidden('no access');
    });
    r.get('/conflict', () => {
      throw conflict('task_locked', 'locked');
    });
    r.get('/boom', () => {
      throw new Error('secret internals');
    });
  });
  app = a;
  return a;
}

describe('problem+json errors', () => {
  it('maps AppError with code and status', async () => {
    const res = await bare().inject({ url: '/nf' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'not_found', status: 404, detail: 'Task not found' });
    expect((await bare().inject({ url: '/forbidden' })).json()).toMatchObject({
      code: 'forbidden',
      status: 403,
    });
    expect((await bare().inject({ url: '/conflict' })).json()).toMatchObject({
      code: 'task_locked',
      status: 409,
    });
  });

  it('returns 400 with issues for zod validation failures', async () => {
    const res = await bare().inject({ method: 'POST', url: '/echo', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json<{ code: string; details: unknown[] }>();
    expect(body.code).toBe('validation_failed');
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('hides internals on unexpected errors', async () => {
    const res = await bare().inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: 'internal_error' });
    expect(res.body).not.toContain('secret internals');
  });

  it('returns problem+json for unknown routes and a request id', async () => {
    const res = await bare().inject({ url: '/nope', headers: { 'x-request-id': 'req-1' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('openapi', () => {
  it('serves /api/openapi.json including zod route schemas', async () => {
    const a = bare();
    const res = await a.inject({ url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.paths['/echo']).toBeDefined();
  });
});

describe('/readyz', () => {
  it('is 200 with a database and 503 once it is closed', async () => {
    const database = await openTestDatabase();
    app = buildApp({ database });
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
    await database.close();
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(503);
  });

  it('is 503 without a database', async () => {
    app = buildApp();
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(503);
  });
});
