import { describe, expect, it } from 'vitest';
import { getProvider, listProviders, validateProviderConfig } from './providers.ts';

describe('provider registry', () => {
  it('has claude and openai enabled, gemini and openai_compatible disabled', () => {
    const enabled = Object.fromEntries(listProviders().map((p) => [p.id, p.adapterEnabled]));
    expect(enabled).toEqual({ claude: true, openai: true, gemini: false, openai_compatible: false });
  });

  it('listProviders returns plain JSON without zod internals', () => {
    const list = listProviders();
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    const oc = list.find((p) => p.id === 'openai_compatible');
    expect(oc?.secretField).toBe('apiKey');
    expect(JSON.stringify(oc?.accountFields)).toContain('baseUrl');
  });

  it('rejects an unknown provider', () => {
    const r = validateProviderConfig('mystery', 'cli', {});
    expect(r.ok).toBe(false);
    expect(getProvider('mystery')).toBeUndefined();
  });

  it('rejects an unsupported account type', () => {
    expect(validateProviderConfig('gemini', 'api', {}).ok).toBe(false);
  });

  it('openai_compatible requires baseUrl and applies defaults', () => {
    expect(validateProviderConfig('openai_compatible', 'api', {}).ok).toBe(false);
    expect(validateProviderConfig('openai_compatible', 'api', { baseUrl: 'not a url' }).ok).toBe(false);
    expect(validateProviderConfig('openai_compatible', 'api', { baseUrl: 'ftp://x.test' }).ok).toBe(false);
    const ok = validateProviderConfig('openai_compatible', 'api', { baseUrl: 'http://localhost:11434/v1' });
    expect(ok).toEqual({
      ok: true,
      providerConfig: { baseUrl: 'http://localhost:11434/v1', models: [], wireApi: 'chat' },
    });
  });

  it('rejects unknown config fields for providers without fields', () => {
    expect(validateProviderConfig('claude', 'cli', { apiKey: 'x' }).ok).toBe(false);
    expect(validateProviderConfig('claude', 'cli', {}).ok).toBe(true);
  });
});
