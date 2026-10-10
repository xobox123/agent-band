import type { FastifyInstance } from 'fastify';
import type { Composition } from '../../composition.ts';
import { accountRoutes } from './accounts.ts';
import { agentRoutes } from './agents.ts';
import { auditRoutes } from './audit.ts';
import { executionRoutes } from './execution.ts';
import { mcpRoutes } from './mcp.ts';
import { eventRoutes, type SseOptions } from './events.ts';
import { orgRoutes } from './org.ts';
import { policyRoutes } from './policies.ts';
import { projectRoutes } from './projects.ts';
import { scheduleRoutes } from './schedules.ts';
import { taskRoutes } from './tasks.ts';
import { usageRoutes } from './usage.ts';

/** Must run after registerPlatform so the OpenAPI plugin sees every route. */
export async function registerApiRoutes(
  app: FastifyInstance,
  c: Composition,
  sse: SseOptions = {},
): Promise<void> {
  await app.register(
    async (api) => {
      await api.register(orgRoutes(c));
      await api.register(accountRoutes(c));
      await api.register(agentRoutes(c));
      await api.register(taskRoutes(c));
      await api.register(projectRoutes(c));
      await api.register(scheduleRoutes(c));
      await api.register(usageRoutes(c));
      await api.register(auditRoutes(c));
      await api.register(eventRoutes(c, sse));
      await api.register(policyRoutes(c));
      await api.register(executionRoutes(c));
      await api.register(mcpRoutes(c));
    },
    { prefix: '/api/v1' },
  );
}
