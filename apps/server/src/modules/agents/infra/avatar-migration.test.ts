import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('migrates legacy avatars to URL, color or initials while preserving nulls', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE agents (id integer, avatar text); INSERT INTO agents VALUES (1, 'https://example.com/a.png'), (2, 'av-12'), (3, 'AB'), (4, 'http://example.com/a.png'), (5, null), (6, '');",
    );
    const migration = await readFile(
      new URL('../../../../drizzle/0009_api_gaps_1.sql', import.meta.url),
      'utf8',
    );
    await db.exec(migration);
    const result = await db.query('SELECT avatar FROM agents ORDER BY id');
    expect(result.rows).toEqual([
      { avatar: { kind: 'url', value: 'https://example.com/a.png' } },
      { avatar: { kind: 'color', value: 'av-12' } },
      { avatar: { kind: 'initials', value: 'AB' } },
      { avatar: { kind: 'initials', value: 'http://example.com/a.png' } },
      { avatar: null },
      { avatar: { kind: 'initials', value: '' } },
    ]);
  } finally {
    await db.close();
  }
});
