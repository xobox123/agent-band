import { homedir } from 'node:os';
import { z } from 'zod';
import { invalid } from '../../../platform/errors.ts';

export const labelsSchema = z
  .array(z.string().trim().min(1).max(63))
  .max(32)
  .refine((l) => new Set(l).size === l.length, 'labels must be unique');

const safeInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const limitsSchema = z
  .object({
    dailyTokenBudget: safeInt.optional(),
    dailyCostBudgetUsd: z.number().positive().max(1_000_000).optional(),
    maxConcurrentRuns: safeInt.default(1),
    stopAt: z
      .object({
        fiveHourPercent: z.number().int().min(1).max(100).optional(),
        weeklyPercent: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A leading `~/` means the user's home, so the form can suggest `~/.claude-work`. */
export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? homedir() + p.slice(1) : p;
}

export const configDirSchema = z
  .string()
  .min(1)
  .max(4096)
  .transform(expandHome)
  .refine((p) => p.startsWith('/'), 'must be an absolute path')
  .refine((p) => !p.includes('\0'), 'must not contain NUL')
  .refine((p) => !p.split('/').includes('..'), 'must not contain ".." segments');

const secretSchema = z
  .string()
  .refine((s) => s.trim().length > 0, 'secret must not be blank')
  .max(8192);

export const createAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    provider: z.string().min(1).max(64),
    type: z.enum(['cli', 'api']),
    providerConfig: z.record(z.string(), z.unknown()).default({}),
    configDir: configDirSchema.optional(),
    managedConfigDir: z.boolean().optional(),
    secret: secretSchema.optional(),
    labels: labelsSchema.default([]),
    limits: limitsSchema.default({ maxConcurrentRuns: 1 }),
  })
  .strict();

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    providerConfig: z.record(z.string(), z.unknown()).optional(),
    configDir: configDirSchema.nullable().optional(),
    secret: secretSchema.optional(),
    labels: labelsSchema.optional(),
    limits: limitsSchema.optional(),
  })
  .strict();

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw invalid(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}
