const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
  plus: 'Plus',
  go: 'Go',
  edu: 'Edu',
  business: 'Business',
  'API key': 'API key',
};

/** "Claude Pro", "ChatGPT Plus", "API key"; unknown plans are capitalised. */
export function planLabel(provider: string, plan: string | null | undefined): string | null {
  if (!plan) return null;
  if (plan === 'API key') return plan;
  const name = PLAN_NAMES[plan.toLowerCase()] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
  if (provider === 'claude') return `Claude ${name}`;
  if (provider === 'openai') return `ChatGPT ${name}`;
  return name;
}

export const STALE_MS = 15 * 60_000;

export function isStale(updatedAt: string | null | undefined, now: number): boolean {
  if (!updatedAt) return true;
  return now - new Date(updatedAt).getTime() > STALE_MS;
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)} min ago`;
  if (mins < 60 * 24) return `${String(Math.round(mins / 60))} h ago`;
  return `${String(Math.round(mins / 60 / 24))} d ago`;
}

/** "in 3h", "in 25 min", "in 2d 4h"; "now" when already past. */
export function resetsIn(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${String(mins)} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${String(h)}h`;
  return `in ${String(Math.floor(h / 24))}d ${String(h % 24)}h`;
}

/** Key of the provider identity behind an account (email and organization), or null when unknown. */
export function identityKey(account: {
  provider: string;
  providerIdentity: string | null;
  connection: { loggedIn: boolean; email: string | null; orgName: string | null } | null;
}): string | null {
  const c = account.connection;
  const who =
    account.providerIdentity?.trim() || (c?.loggedIn && c.email ? `${c.email}|${c.orgName ?? ''}` : '');
  return who ? `${account.provider}:${who.toLowerCase()}` : null;
}

/** For every account that shares its provider identity with another, the other accounts' names. */
type Identified = Parameters<typeof identityKey>[0] & { id: string; name: string };

export function duplicateIdentities(accounts: Identified[]): Map<string, string[]> {
  const byKey = new Map<string, Identified[]>();
  for (const a of accounts) {
    const key = identityKey(a);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  const out = new Map<string, string[]>();
  for (const group of byKey.values())
    if (group.length > 1)
      for (const a of group)
        out.set(
          a.id,
          group.filter((b) => b.id !== a.id).map((b) => b.name),
        );
  return out;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'account'
  );
}

/** The command a user runs in a terminal to log in a separate account. */
export function suggestedLoginCommand(provider: string, name: string): string {
  const slug = slugify(name);
  return provider === 'openai'
    ? `CODEX_HOME=~/.codex-${slug} codex login`
    : `CLAUDE_CONFIG_DIR=~/.claude-${slug} claude auth login`;
}
