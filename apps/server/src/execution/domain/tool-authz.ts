import { posix } from 'node:path';
import { isPathAllowed } from '../../modules/policy/domain/paths.ts';

export interface ToolPolicySnapshot {
  allowedTools?: string[];
  deniedTools: string[];
  workDirSets: string[][];
}

export interface ToolDecision {
  decision: 'allow' | 'deny';
  reason: string;
}

const allow = (reason: string): ToolDecision => ({ decision: 'allow', reason });
const deny = (reason: string): ToolDecision => ({ decision: 'deny', reason });

const FILE_TOOLS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
};
const SEARCH_TOOLS = new Set(['Glob', 'Grep']);

/** "Bash(git:*)" -> { name: "Bash", scoped: true }. */
function parseRule(rule: string): { name: string; scoped: boolean } {
  const i = rule.indexOf('(');
  return i < 0 ? { name: rule, scoped: false } : { name: rule.slice(0, i), scoped: true };
}

function nameMatches(pattern: string, tool: string): boolean {
  return pattern.endsWith('*') ? tool.startsWith(pattern.slice(0, -1)) : pattern === tool;
}

function resolvePath(raw: unknown, workDir: string): string | undefined {
  if (typeof raw !== 'string' || raw === '' || raw.includes('\0') || raw.startsWith('~')) return undefined;
  return posix.normalize(posix.isAbsolute(raw) ? raw : posix.join(workDir, raw));
}

/** Static directory prefix of a glob pattern (up to the first wildcard segment). */
function globBase(pattern: string): string {
  const parts = pattern.split('/');
  const fixed: string[] = [];
  for (const part of parts) {
    if (/[*?[\]{}]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join('/') || '/';
}

function pathsOf(tool: string, input: Record<string, unknown>, workDir: string): string[] | string {
  const field = FILE_TOOLS[tool];
  if (field) {
    const p = resolvePath(input[field], workDir);
    return p === undefined ? `${tool} requires a valid ${field}` : [p];
  }
  if (!SEARCH_TOOLS.has(tool)) return [];
  const paths: string[] = [];
  if (input['path'] !== undefined) {
    const p = resolvePath(input['path'], workDir);
    if (p === undefined) return `${tool} has an invalid path`;
    paths.push(p);
  } else paths.push(posix.normalize(workDir));
  const pattern = input['pattern'];
  if (tool === 'Glob' && typeof pattern === 'string' && pattern.startsWith('/')) {
    paths.push(posix.normalize(globBase(pattern)));
  }
  if (tool === 'Glob' && typeof pattern === 'string' && pattern.split('/').includes('..')) {
    return 'Glob pattern must not contain ..';
  }
  return paths;
}

export function decideTool(
  policy: ToolPolicySnapshot,
  workDir: string,
  toolName: string,
  toolInput: unknown,
): ToolDecision {
  for (const rule of policy.deniedTools) {
    const r = parseRule(rule);
    if (!r.scoped && nameMatches(r.name, toolName)) return deny(`tool ${toolName} is denied by policy`);
  }
  if (
    policy.allowedTools &&
    !policy.allowedTools.some((rule) => nameMatches(parseRule(rule).name, toolName))
  ) {
    return deny(`tool ${toolName} is not in the allowed tools`);
  }
  const input =
    toolInput !== null && typeof toolInput === 'object' ? (toolInput as Record<string, unknown>) : {};
  const paths = pathsOf(toolName, input, workDir);
  if (typeof paths === 'string') return deny(paths);
  for (const p of paths) {
    if (!isPathAllowed(p, policy.workDirSets)) return deny(`path ${p} is outside the allowed directories`);
  }
  return allow('allowed by policy');
}
