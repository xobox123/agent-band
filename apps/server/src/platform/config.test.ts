import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(4870);
    expect(c.role).toBe('all');
    expect(c.logLevel).toBe('info');
    expect(c.home.endsWith('.agent-band')).toBe(true);
    expect(c.databaseUrl).toBeUndefined();
  });

  it('parses provided values', () => {
    const c = loadConfig({
      AGENT_BAND_PORT: '5000',
      AGENT_BAND_ROLE: 'worker',
      DATABASE_URL: 'postgres://x',
    });
    expect(c).toMatchObject({ port: 5000, role: 'worker', databaseUrl: 'postgres://x' });
  });

  it('rejects an invalid role with a readable message', () => {
    expect(() => loadConfig({ AGENT_BAND_ROLE: 'boss' })).toThrow(/AGENT_BAND_ROLE/);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ AGENT_BAND_PORT: 'abc' })).toThrow(/AGENT_BAND_PORT/);
  });
});
