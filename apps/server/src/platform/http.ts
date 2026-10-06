import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Database } from './db.ts';
import { AppError, invalid } from './errors.ts';

export interface PlatformOptions {
  database?: Database;
}

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  details?: unknown;
}

export function registerPlatform(app: FastifyInstance, options: PlatformOptions = {}): void {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  void app.register(swagger, {
    openapi: { info: { title: 'agent-band', version: '0.0.0' } },
    transform: jsonSchemaTransform,
  });

  app.get('/api/openapi.json', { schema: { hide: true } }, () => app.swagger());

  app.get('/readyz', { schema: { hide: true } }, async (_req, reply) => {
    try {
      if (!options.database) throw new Error('no database');
      await options.database.db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  app.addHook('onSend', (req, reply, payload, done) => {
    reply.header('x-request-id', req.id);
    done(null, payload);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    let appError: AppError;
    if (err instanceof AppError) {
      appError = err;
    } else if (hasZodFastifySchemaValidationErrors(err)) {
      appError = invalid(err.validation);
    } else if (isHttpError(err) && err.statusCode >= 400 && err.statusCode < 500) {
      appError = new AppError(err.code ?? 'bad_request', err.statusCode, err.message);
    } else {
      req.log.error({ err }, 'unhandled error');
      appError = new AppError('internal_error', 500, 'Internal server error');
    }
    const body: Problem = {
      type: 'about:blank',
      title: statusTitle(appError.status),
      status: appError.status,
      code: appError.code,
      detail: appError.message,
      requestId: req.id,
    };
    if (appError.details !== undefined) body.details = appError.details;
    return reply.code(appError.status).type('application/problem+json').send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: Problem = {
      type: 'about:blank',
      title: statusTitle(404),
      status: 404,
      code: 'not_found',
      detail: `Route ${req.method} ${req.url} not found`,
      requestId: req.id,
    };
    return reply.code(404).type('application/problem+json').send(body);
  });
}

function isHttpError(err: unknown): err is { statusCode: number; code?: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  );
}

function statusTitle(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
  };
  return titles[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}
