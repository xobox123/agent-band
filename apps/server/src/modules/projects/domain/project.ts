import { z } from 'zod';

const AbsolutePath = z
  .string()
  .max(4096)
  .refine((p) => p.startsWith('/') && !p.includes('\0'), 'must be an absolute path');
const Checks = z.array(z.string().trim().min(1).max(1000)).max(20);

export const CreateProject = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .optional(),
    repoPath: AbsolutePath,
    worktreesRoot: AbsolutePath.optional(),
    checks: Checks.default([]),
    keepWorktrees: z.boolean().default(false),
  })
  .strict();
export type CreateProjectInput = z.input<typeof CreateProject>;

export const UpdateProject = z
  .object({
    name: z.string().trim().min(1).max(100),
    checks: Checks,
    keepWorktrees: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateProjectInput = z.input<typeof UpdateProject>;

export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}

export const CHECK_TIMEOUT_MS = 15 * 60_000;
export const CHECK_OUTPUT_MAX_BYTES = 16 * 1024;
export const DIFF_MAX_BYTES = 512 * 1024;

export interface FileStat {
  path: string;
  additions: number;
  deletions: number;
}

export function summarizeStat(files: FileStat[]): { files: number; additions: number; deletions: number } {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}

/** Parses `git diff --numstat` output; binary files report `-` and count as zero lines. */
export function parseNumstat(out: string): FileStat[] {
  const files: FileStat[] = [];
  for (const line of out.split('\n')) {
    const [add, del, ...rest] = line.split('\t');
    const path = rest.join('\t');
    if (!path || add === undefined || del === undefined) continue;
    files.push({ path, additions: Number(add) || 0, deletions: Number(del) || 0 });
  }
  return files;
}

/** Keeps the end of the output, where failures are reported, within the byte budget. */
export function tailBytes(text: string, max: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= max) return text;
  let start = buf.length - max;
  while (start < buf.length && ((buf[start] ?? 0) & 0xc0) === 0x80) start++;
  return buf.subarray(start).toString('utf8');
}

export function feedbackPrompt(prompt: string, feedback: string, attempt: number): string {
  return `${prompt}\n\nReviewer feedback (attempt ${attempt}). Fix the issues below in the same worktree:\n${feedback}`;
}
