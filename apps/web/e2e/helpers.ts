import type { APIRequestContext } from '@playwright/test';

export const SHOTS = '/tmp/claude-501';

export async function seedAgent(request: APIRequestContext, slug: string, enabled = true) {
  const account = await request.post('/api/v1/accounts', {
    data: { name: `acc-${slug}`, provider: 'claude', type: 'cli', configDir: `/tmp/ab-e2e-${slug}` },
  });
  const accountId = ((await account.json()) as { id: string }).id;
  const agent = await request.post('/api/v1/agents', {
    data: { slug, name: `Agent ${slug}`, accountId, enabled },
  });
  return (await agent.json()) as { id: string; name: string };
}

export async function seedTask(request: APIRequestContext, title: string, agentId: string) {
  const res = await request.post('/api/v1/tasks', {
    data: { title, prompt: 'p', target: { agentId }, draft: true },
  });
  return (await res.json()) as { id: string; key: string };
}
