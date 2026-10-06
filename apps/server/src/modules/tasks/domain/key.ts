const PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;

export function formatTaskKey(prefix: string, seq: number): string {
  if (!PREFIX.test(prefix)) throw new Error(`invalid task key prefix: ${prefix}`);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`invalid task sequence: ${seq}`);
  return `${prefix}-${seq}`;
}
