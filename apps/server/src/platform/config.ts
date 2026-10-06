import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  AGENT_BAND_PORT: z.coerce.number().int().min(1).max(65535).default(4870),
  AGENT_BAND_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  AGENT_BAND_HOME: z.string().min(1).default(join(homedir(), '.agent-band')),
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  port: number;
  role: 'api' | 'worker' | 'all';
  home: string;
  databaseUrl?: string;
  pgliteDir?: string;
  logLevel: string;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    port: e.AGENT_BAND_PORT,
    role: e.AGENT_BAND_ROLE,
    home: e.AGENT_BAND_HOME,
    databaseUrl: e.DATABASE_URL,
    pgliteDir: e.PGLITE_DIR,
    logLevel: e.LOG_LEVEL,
  };
}
