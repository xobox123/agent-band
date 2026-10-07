import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AccountDto,
  AccountList,
  AccountQuery,
  CreateAccountBody,
  IdParams,
  LoginBody,
  LoginResult,
  ModelList,
  ProbeConfigBody,
  ProbeResult,
  RefreshLimitsResult,
  ProviderList,
  SetProviderIdentityBody,
  UpdateAccountBody,
} from '@agent-band/contracts';
import type { Composition } from '../../composition.ts';

/** After an API key is stored, prepares the harness home and records the connection; failures are not fatal. */
async function verifyAfterChange(
  c: Composition,
  actor: Parameters<Composition['accountConnection']['probe']>[0],
  id: string,
  isApiKey: boolean,
) {
  if (!isApiKey) return null;
  try {
    await c.accountConnection.probe(actor, id);
  } catch {
    return null;
  }
  return c.accounts.getAccount(c.database.db, actor, id);
}

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
        const actor = await c.resolveActor(req);
        const account = await c.accounts.createAccount(db, actor, req.body);
        const connected = await verifyAfterChange(c, actor, account.id, account.type === 'api');
        return reply.code(201).send(connected ?? account);
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
      async (req) => {
        const actor = await c.resolveActor(req);
        const account = await c.accounts.updateAccount(db, actor, req.params.id, req.body);
        const isKey = account.type === 'api' && req.body.secret !== undefined;
        return (await verifyAfterChange(c, actor, account.id, isKey)) ?? account;
      },
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

    app.post(
      '/accounts/probe-config',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Check a CLI login before saving the account (no tokens spent)',
          body: ProbeConfigBody,
          response: { 200: ProbeResult },
        },
      },
      async (req) => c.accountConnection.probeConfig(await c.resolveActor(req), req.body),
    );

    app.get(
      '/accounts/:id/models',
      {
        schema: {
          tags: ['accounts'],
          summary: "List the models the account's provider offers (cached for an hour)",
          params: IdParams,
          response: { 200: ModelList },
        },
      },
      async (req) => c.accountConnection.listModels(await c.resolveActor(req), req.params.id),
    );

    app.post(
      '/accounts/:id/probe',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Check the CLI login and store identity and plan (no tokens spent)',
          params: IdParams,
          response: { 200: ProbeResult },
        },
      },
      async (req) => c.accountConnection.probe(await c.resolveActor(req), req.params.id),
    );

    app.post(
      '/accounts/:id/login',
      {
        schema: {
          tags: ['accounts'],
          summary: "Start the provider's own browser login for this account",
          params: IdParams,
          body: LoginBody.nullish(),
          response: { 200: LoginResult },
        },
      },
      async (req) => c.accountConnection.login(await c.resolveActor(req), req.params.id, req.body?.mode),
    );

    app.post(
      '/accounts/:id/refresh-limits',
      {
        schema: {
          tags: ['accounts'],
          summary: 'Read the limit windows from the provider CLI (free, no model call)',
          params: IdParams,
          response: { 200: RefreshLimitsResult },
        },
      },
      async (req) => c.accountConnection.refreshLimits(await c.resolveActor(req), req.params.id),
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
