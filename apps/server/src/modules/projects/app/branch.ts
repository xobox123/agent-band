import { summarizeStat, type FileStat } from '../domain/project.ts';
import { commitsBetween, diffFiles, mergeBase, revParse } from '../infra/git.ts';

export interface BranchRange {
  baseSha: string;
  headSha: string;
  files: FileStat[];
  commits: { sha: string; subject: string }[];
  diffStat: ReturnType<typeof summarizeStat>;
}

/** Commits of `head` that are not in `base`, measured from where the branch left the base. */
export async function branchRange(cwd: string, base: string, head: string): Promise<BranchRange> {
  const baseSha = await mergeBase(cwd, base, head);
  const headSha = await revParse(cwd, head);
  const files = await diffFiles(cwd, baseSha, headSha);
  const commits = await commitsBetween(cwd, baseSha, headSha);
  return { baseSha, headSha, files, commits, diffStat: summarizeStat(files) };
}
