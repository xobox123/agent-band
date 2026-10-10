export interface FileDiff {
  path: string;
  text: string;
}

/** Splits a unified diff into one chunk per file, in order. */
export function splitDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  for (const chunk of diff.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue;
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk);
    files.push({ path: header?.[2] ?? 'unknown', text: chunk });
  }
  return files;
}
