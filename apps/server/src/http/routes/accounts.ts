import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AccountDto,
  AccountList,
  AccountQuery,
  CreateAccountBody,
  IdParams,
  ProviderList,
  SetPausedBody,
  SetProviderIdentityBody,
  UpdateAccountBody,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';

export function accountRoutes(c: Composition): FastifyPluginCallbackZod {
  const db = c.database.db;
  return (app, _opts, done) => {
    app.get(
      '/providers',
      {
        schema: {
          tags: ['accounts'],
          summary: 'List provider descriptors',
          response: { 200: ProviderList },
        },
      },
      async (req) => {
        const actor = await c.resolveActor(req);
        await c.ports.authorizer.authorize(db, actor, 'read', {});
        return { items: c.listProviders() };
      },
    );

    app.get(
      '/accounts',
      {
        schema: {
          tags: ['accounts'],
          summary: 'List accounts',
          querystring: AccountQuery,
          response: { 200: AccountList },
        },
      },
      async (req) => {
        const cursor = await c.cursor();
        return { items: await c.accounts.listAccounts(db, await c.resolveActor(req), req.query), cursor };
      },
    );

    app.post(
      '/accounts',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Create an account',
          body: CreateAccountBody,
          response: { 201: AccountDto },
        },
      },
      async (req, reply) => {
        const account = await c.accounts.createAccount(db, await c.resolveActor(req), req.body);
        return reply.code(201).send(account);
      },
    );

    app.get(
      '/accounts/:id',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Get an account',
          params: IdParams,
          response: { 200: AccountDto },
        },
      },
      async (req) => c.accounts.getAccount(db, await c.resolveActor(req), req.params.id),
    );

    app.patch(
      '/accounts/:id',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Update an account',
          params: IdParams,
          body: UpdateAccountBody,
          response: { 200: AccountDto },
        },
      },
      async (req) => c.accounts.updateAccount(db, await c.resolveActor(req), req.params.id, req.body),
    );

    app.put(
      '/accounts/:id/provider-identity',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Record the signed-in provider identity',
          params: IdParams,
          body: SetProviderIdentityBody,
          response: { 200: AccountDto },
        },
      },
      async (req) =>
        c.accounts.setAccountProviderIdentity(
          db,
          await c.resolveActor(req),
          req.params.id,
          req.body.providerIdentity,
        ),
    );

    app.put(
      '/accounts/:id/pause',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Pause or resume an account; its agents get no new tasks while paused',
          params: IdParams,
          body: SetPausedBody,
          response: { 200: AccountDto },
        },
      },
      async (req) =>
        c.accounts.setAccountPaused(db, await c.resolveActor(req), req.params.id, req.body.paused),
    );

    app.delete(
      '/accounts/:id',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Delete an account',
          params: IdParams,
          response: { 204: z.null() },
        },
      },
      async (req, reply) => {
        await c.accounts.deleteAccount(db, await c.resolveActor(req), req.params.id);
        return reply.code(204).send(null);
      },
    );
    done();
  };
}
