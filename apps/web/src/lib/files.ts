export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A single .zip becomes `zip`; any other selection becomes a `files` map keyed by relative path. */
export async function bundleFromFiles(
  files: File[],
): Promise<{ zip: string } | { files: Record<string, string> }> {
  const only = files.length === 1 ? files[0] : undefined;
  if (only && only.name.toLowerCase().endsWith('.zip')) return { zip: await fileToBase64(only) };
  const map: Record<string, string> = {};
  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = rel ? rel.split('/').slice(1).join('/') || file.name : file.name;
    map[path] = await fileToBase64(file);
  }
  return { files: map };
}
