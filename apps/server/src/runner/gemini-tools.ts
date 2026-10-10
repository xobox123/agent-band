/** Claude tool name -> Gemini CLI built-in tool names. Policy rules use the Claude names. */
const TOOL_NAMES: Record<string, string[]> = {
  Read: ['read_file'],
  Write: ['write_file'],
  Edit: ['replace'],
  MultiEdit: ['replace'],
  Glob: ['glob', 'list_directory'],
  Grep: ['grep_search', 'search_file_content'],
  Bash: ['run_shell_command'],
  WebFetch: ['web_fetch'],
  WebSearch: ['google_web_search'],
};

/**
 * Built-ins whose path arguments the policy cannot check (several globs at once). They are excluded
 * natively, and the hook denies them too.
 */
export const GEMINI_UNCHECKABLE_TOOLS: readonly string[] = ['read_many_files'];

/** Inverse of TOOL_NAMES: the Claude name a Gemini built-in is judged as by the policy. */
export const CLAUDE_NAME_OF: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(TOOL_NAMES).flatMap(([claude, gemini]) =>
    gemini.map((g) => [g, claude === 'MultiEdit' ? 'Edit' : claude] as const),
  ),
);

/** Whole-tool Claude names (no argument scope) to Gemini names; unmapped names are dropped. */
export function geminiToolNames(rules: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const rule of rules ?? []) {
    if (rule.includes('(')) continue;
    for (const name of TOOL_NAMES[rule] ?? []) out.add(name);
  }
  return [...out];
}

/**
 * Claude pre-approved rules ("Read", "Bash", "Bash(git:*)", "Bash(npm test)") to the values of
 * Gemini's --allowed-tools, which auto-approves matching calls ("run_shell_command(git)" is a prefix rule).
 */
export function geminiAllowedTools(rules: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const rule of rules ?? []) {
    const open = rule.indexOf('(');
    if (open < 0) {
      for (const name of TOOL_NAMES[rule] ?? []) out.add(name);
    } else if (rule.slice(0, open) === 'Bash' && rule.endsWith(')')) {
      const pattern = rule.slice(open + 1, -1).trim();
      const prefix = pattern.endsWith(':*') ? pattern.slice(0, -2) : pattern;
      if (prefix !== '') out.add(`run_shell_command(${prefix})`);
    }
  }
  return [...out];
}
