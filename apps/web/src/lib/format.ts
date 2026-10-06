export function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unknown';
  return `$${String(Number(value.toFixed(6)))}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function copyText(text: string) {
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

export function toggleIn<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
