import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';

export type Db = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export interface Database {
  db: Db;
  listen(channel: string, fn: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface DatabaseConfig {
  databaseUrl?: string;
  pgliteDir?: string;
  memory?: boolean;
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function openPostgres(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url });
  pool.on('error', () => undefined);
  const client = drizzlePg(pool);
  try {
    await migratePg(client, { migrationsFolder });
  } catch (err) {
    await pool.end();
    throw err;
  }

  const listeners = new Set<pg.Client>();
  return {
    db: client,
    async listen(channel, fn) {
      const conn = new pg.Client({ connectionString: url });
      conn.on('error', () => undefined);
      await conn.connect();
      conn.on('notification', (msg) => {
        if (msg.channel === channel) fn(msg.payload ?? '');
      });
      await conn.query(`LISTEN ${quoteIdent(channel)}`);
      listeners.add(conn);
      return async () => {
        if (!listeners.delete(conn)) return;
        await conn.end();
      };
    },
    async close() {
      await Promise.all([...listeners].map((c) => c.end()));
      listeners.clear();
      await pool.end();
    },
  };
}

function wrapPglite(lite: PGlite): Database {
  return {
    db: drizzlePglite(lite),
    async listen(channel, fn) {
      return lite.listen(channel, fn);
    },
    async close() {
      await lite.close();
    },
  };
}

async function openPglite(dir: string | undefined): Promise<Database> {
  const lite = dir ? new PGlite(dir) : new PGlite();
  const client = drizzlePglite(lite);
  try {
    await migratePglite(client, { migrationsFolder });
  } catch (err) {
    await lite.close();
    throw err;
  }

  return wrapPglite(lite);
}

export async function openDatabase(cfg: DatabaseConfig): Promise<Database> {
  if (cfg.databaseUrl) return openPostgres(cfg.databaseUrl);
  return openPglite(cfg.pgliteDir);
}

let migratedSnapshot: Promise<File | Blob> | undefined;

async function buildMigratedSnapshot(): Promise<File | Blob> {
  const lite = new PGlite();
  try {
    await migratePglite(drizzlePglite(lite), { migrationsFolder });
    return await lite.dumpDataDir('none');
  } finally {
    await lite.close();
  }
}

// Migrations run once per process; each call restores an isolated instance from the snapshot.
export async function openTestDatabase(): Promise<Database> {
  migratedSnapshot ??= buildMigratedSnapshot();
  const loadDataDir = await migratedSnapshot;
  return wrapPglite(new PGlite({ loadDataDir }));
}
