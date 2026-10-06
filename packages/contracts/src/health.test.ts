import { describe, expect, it } from 'vitest';
import { HealthResponse } from './index.ts';

describe('HealthResponse', () => {
  it('accepts status ok', () => {
    expect(HealthResponse.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects other statuses', () => {
    expect(HealthResponse.safeParse({ status: 'down' }).success).toBe(false);
  });
});
