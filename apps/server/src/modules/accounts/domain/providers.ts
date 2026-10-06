import { z } from 'zod';

export type Harness = 'claude-cli' | 'codex-cli' | 'gemini-cli';
export type AccountType = 'cli' | 'api';

export interface ProviderCapabilities {
  runtimeToolEnforcement: boolean;
  limitWindows: ('5h' | 'weekly')[];
  costReporting: boolean;
  skills: boolean;
  systemPrompt: boolean;
}

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  harness: Harness;
  accountTypes: AccountType[];
  accountFields: z.ZodType<Record<string, unknown>>;
  /** Name of the write-only secret field, when the provider has one. */
  secretField?: string;
  adapterEnabled: boolean;
  capabilities: ProviderCapabilities;
}

export interface ProviderInfo {
  id: string;
  displayName: string;
  harness: Harness;
  accountTypes: AccountType[];
  accountFields: unknown;
  secretField: string | null;
  adapterEnabled: boolean;
  capabilities: ProviderCapabilities;
}

const noFields = z.object({}).strict();

const openaiCompatibleFields = z
  .object({
    baseUrl: z
      .url()
      .refine((u) => /^https?:\/\//i.test(u), 'baseUrl must be an http(s) URL')
      .max(2048),
    models: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
    wireApi: z.enum(['chat', 'responses']).default('chat'),
  })
  .strict();

const REGISTRY: readonly ProviderDescriptor[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    harness: 'claude-cli',
    accountTypes: ['cli', 'api'],
    accountFields: noFields,
    adapterEnabled: true,
    capabilities: {
      runtimeToolEnforcement: true,
      limitWindows: ['5h', 'weekly'],
      costReporting: true,
      skills: true,
      systemPrompt: true,
    },
  },
  {
    id: 'openai',
    displayName: 'Codex CLI',
    harness: 'codex-cli',
    accountTypes: ['cli', 'api'],
    accountFields: noFields,
    adapterEnabled: true,
    capabilities: {
      runtimeToolEnforcement: false,
      limitWindows: ['5h', 'weekly'],
      costReporting: false,
      skills: true,
      systemPrompt: true,
    },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    harness: 'gemini-cli',
    accountTypes: ['cli'],
    accountFields: noFields,
    adapterEnabled: false,
    capabilities: {
      runtimeToolEnforcement: false,
      limitWindows: [],
      costReporting: false,
      skills: false,
      systemPrompt: true,
    },
  },
  {
    id: 'openai_compatible',
    displayName: 'OpenAI-compatible endpoint',
    harness: 'codex-cli',
    accountTypes: ['api'],
    accountFields: openaiCompatibleFields,
    secretField: 'apiKey',
    adapterEnabled: false,
    capabilities: {
      runtimeToolEnforcement: false,
      limitWindows: [],
      costReporting: false,
      skills: true,
      systemPrompt: true,
    },
  },
];

export function getProvider(id: string): ProviderDescriptor | undefined {
  return REGISTRY.find((p) => p.id === id);
}

export function listProviders(): ProviderInfo[] {
  return REGISTRY.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    harness: p.harness,
    accountTypes: [...p.accountTypes],
    accountFields: z.toJSONSchema(p.accountFields),
    secretField: p.secretField ?? null,
    adapterEnabled: p.adapterEnabled,
    capabilities: { ...p.capabilities, limitWindows: [...p.capabilities.limitWindows] },
  }));
}

export type ProviderCheck =
  | { ok: true; providerConfig: Record<string, unknown> }
  | { ok: false; issues: { path: string; message: string }[] };

export function validateProviderConfig(provider: string, type: AccountType, config: unknown): ProviderCheck {
  const d = getProvider(provider);
  if (!d) return { ok: false, issues: [{ path: 'provider', message: `unknown provider "${provider}"` }] };
  if (!d.accountTypes.includes(type)) {
    return {
      ok: false,
      issues: [{ path: 'type', message: `provider "${provider}" does not support type "${type}"` }],
    };
  }
  const parsed = d.accountFields.safeParse(config ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: ['providerConfig', ...i.path].join('.'),
        message: i.message,
      })),
    };
  }
  return { ok: true, providerConfig: parsed.data };
}
