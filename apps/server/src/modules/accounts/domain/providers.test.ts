import { describe, expect, it } from 'vitest';
import { getProvider, listProviders, validateProviderConfig } from './providers.ts';

describe('provider registry', () => {
  it('has claude, openai and gemini enabled, openai_compatible disabled', () => {
    const enabled = Object.fromEntries(listProviders().map((p) => [p.id, p.adapterEnabled]));
    expect(enabled).toEqual({ claude: true, openai: true, gemini: true, openai_compatible: false });
  });

  it('runs gemini for cli (Google OAuth) and api (GEMINI_API_KEY) accounts on the gemini-cli harness', () => {
    const gemini = listProviders().find((p) => p.id === 'gemini');
    expect(gemini).toMatchObject({
      harness: 'gemini-cli',
      accountTypes: ['cli', 'api'],
      runnableTypes: ['cli', 'api'],
      secretField: null,
    });
    expect(validateProviderConfig('gemini', 'cli', {}).ok).toBe(true);
    expect(validateProviderConfig('gemini', 'api', {}).ok).toBe(true);
  });

  it('does not fake 5h or weekly windows or cost for gemini, and enforces tools through the hook', () => {
    expect(getProvider('gemini')?.capabilities).toEqual({
      runtimeToolEnforcement: true,
      limitWindows: [],
      costReporting: false,
      skills: false,
      systemPrompt: true,
    });
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
    expect(validateProviderConfig('openai_compatible', 'cli', {}).ok).toBe(false);
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
