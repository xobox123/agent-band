import type { Db } from './db.ts';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
