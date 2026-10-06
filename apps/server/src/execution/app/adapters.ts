import type { ProviderAdapter } from '@agent-band/contracts';
import type { AccountForRun } from '../../modules/accounts/index.ts';
import { ApiStubAdapter, ClaudeAdapter, CodexAdapter } from '../../runner/index.ts';

export function defaultAdapterFor(account: AccountForRun): ProviderAdapter | undefined {
  if (account.type === 'api') return new ApiStubAdapter();
  if (account.provider === 'claude') return new ClaudeAdapter();
  if (account.provider === 'openai') return new CodexAdapter();
  return undefined;
}
