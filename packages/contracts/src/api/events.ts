import { z } from 'zod';

/** Data of the SSE `reset` event: the client must refetch its snapshot and continue from `cursor`. */
export const SseResetData = z.object({ cursor: z.number().int().nonnegative() });
export type SseResetData = z.infer<typeof SseResetData>;

export const SSE_HEARTBEAT_MS = 15_000;
export const OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;
