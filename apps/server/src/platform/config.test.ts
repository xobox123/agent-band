import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(4870);
    expect(c.role).toBe('all');
    expect(c.logLevel).toBe('info');
    expect(c.workerSlots).toBe(4);
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

  it('parses and validates worker slots', () => {
    expect(loadConfig({ AGENT_BAND_WORKER_SLOTS: '2' }).workerSlots).toBe(2);
    expect(() => loadConfig({ AGENT_BAND_WORKER_SLOTS: '0' })).toThrow(/AGENT_BAND_WORKER_SLOTS/);
  });

  it('parses the scheduler interval', () => {
    expect(loadConfig({}).schedulerIntervalMs).toBe(15_000);
    expect(loadConfig({ AGENT_BAND_SCHEDULER_INTERVAL_MS: '500' }).schedulerIntervalMs).toBe(500);
    expect(() => loadConfig({ AGENT_BAND_SCHEDULER_INTERVAL_MS: '5' })).toThrow(
      /AGENT_BAND_SCHEDULER_INTERVAL_MS/,
    );
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ AGENT_BAND_PORT: 'abc' })).toThrow(/AGENT_BAND_PORT/);
  });
});
