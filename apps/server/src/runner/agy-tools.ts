/**
 * Antigravity built-in tool name -> the Claude tool name the policy judges it as, and the argument
 * keys that hold its path. Verified against real hook payloads: view_file (AbsolutePath),
 * write_to_file and replace_file_content (TargetFile), run_command (CommandLine), read_url_content
 * (Url), search_web (query). The keys of list_dir, find_by_name and grep_search are not verified:
 * the hook scans for any *Path/*Dir/*Directory/*File key and denies the call when none is found.
 */
export const AGY_CLAUDE_NAME_OF: Readonly<Record<string, string>> = {
  view_file: 'Read',
  write_to_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'Edit',
  list_dir: 'Glob',
  find_by_name: 'Glob',
  grep_search: 'Grep',
  run_command: 'Bash',
  read_url_content: 'WebFetch',
  search_web: 'WebSearch',
};

/** Tools that run other tools or agents, or act outside the policy's reach: always denied by the hook. */
export const AGY_UNCHECKABLE_TOOLS: readonly string[] = [
  'sed_file',
  'notebook_edit',
  'notebook_execution',
  'invoke_subagent',
  'define_subagent',
  'run_workflow',
];
