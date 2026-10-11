import type { ProviderAdapter } from '@agent-band/contracts';
import type { AccountForRun } from '../../modules/accounts/index.ts';
import {
  AntigravityAdapter,
  ApiStubAdapter,
  ClaudeAdapter,
  CodexAdapter,
  GeminiAdapter,
} from '../../runner/index.ts';

export function defaultAdapterFor(account: AccountForRun): ProviderAdapter | undefined {
  if (
    account.type === 'api' &&
    account.provider !== 'claude' &&
    account.provider !== 'openai' &&
    account.provider !== 'gemini'
  )
    return new ApiStubAdapter();
  if (account.provider === 'claude') return new ClaudeAdapter();
  if (account.provider === 'openai') return new CodexAdapter();
  if (account.provider === 'gemini') return new GeminiAdapter();
  if (account.provider === 'antigravity') return new AntigravityAdapter();
  return undefined;
}
