import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { tmp } from './worker.testkit.ts';
import { treeFingerprint } from './tree-fingerprint.ts';

describe('treeFingerprint', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await tmp();
    mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q']);
  });

  it('sees edits to staged files before the first commit', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a');
    execFileSync('git', ['-C', dir, 'add', 'a.txt']);
    const before = await treeFingerprint(dir);
    expect(before).toBeDefined();
    expect(await treeFingerprint(dir)).toBe(before);
    writeFileSync(join(dir, 'a.txt'), 'changed');
    expect(await treeFingerprint(dir)).not.toBe(before);
  });

  it('is undefined outside a git work tree', async () => {
    expect(await treeFingerprint(await tmp())).toBeUndefined();
  });
});
