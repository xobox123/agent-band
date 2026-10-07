import { describe, expect, it } from 'vitest';
import { getProvider, listProviders, validateProviderConfig } from './providers.ts';

describe('provider registry', () => {
  it('has claude, openai, gemini and antigravity enabled, openai_compatible disabled', () => {
    const enabled = Object.fromEntries(listProviders().map((p) => [p.id, p.adapterEnabled]));
    expect(enabled).toEqual({
      claude: true,
      openai: true,
      gemini: true,
      antigravity: true,
      openai_compatible: false,
    });
  });

  it('runs gemini only for api accounts: Google no longer serves consumer plans through Gemini CLI', () => {
    const gemini = listProviders().find((p) => p.id === 'gemini');
    expect(gemini).toMatchObject({
      harness: 'gemini-cli',
      accountTypes: ['api'],
      runnableTypes: ['api'],
      secretField: null,
    });
    expect(validateProviderConfig('gemini', 'cli', {}).ok).toBe(false);
    expect(validateProviderConfig('gemini', 'api', {}).ok).toBe(true);
  });

  it('runs antigravity for cli accounts on the antigravity-cli harness with real limit windows', () => {
    expect(listProviders().find((p) => p.id === 'antigravity')).toMatchObject({
      harness: 'antigravity-cli',
      accountTypes: ['cli'],
      runnableTypes: ['cli'],
    });
    expect(getProvider('antigravity')?.capabilities).toEqual({
      runtimeToolEnforcement: true,
      limitWindows: ['5h', 'weekly'],
      costReporting: false,
      skills: false,
      systemPrompt: true,
    });
    expect(validateProviderConfig('antigravity', 'cli', {}).ok).toBe(true);
    expect(validateProviderConfig('antigravity', 'api', {}).ok).toBe(false);
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
