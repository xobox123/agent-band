export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export interface ServerEvent {
  type: string;
  /** Exact outbox id as received. */
  id: string;
  data: unknown;
}

export interface EventsClient {
  /** Opens the stream with the first subscriber and closes it after the last one leaves. */
  subscribe(fn: (event: ServerEvent) => void): () => void;
  onState(fn: (state: ConnectionState) => void): () => void;
  state(): ConnectionState;
}

export const EVENT_TYPES = [
  'reset',
  'task.created',
  'task.updated',
  'task.moved',
  'task.cancel_requested',
  'run.updated',
  'run.event',
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'agent_group.created',
  'agent_group.updated',
  'agent_group.deleted',
  'agent_group.member_added',
  'agent_group.member_removed',
  'account.created',
  'account.updated',
  'account.deleted',
  'policy.updated',
  'skill.updated',
  'skill.assignment.updated',
  'schedule.updated',
  'project.updated',
  'org.changed',
];

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

interface Options {
  url?: string;
  eventSource?: typeof EventSource | undefined;
  /** Test hook for the reconnect timer. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export function createEventsClient(options: Options = {}): EventsClient {
  const url = options.url ?? '/api/v1/events';
  const timer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const listeners = new Set<(event: ServerEvent) => void>();
  const stateListeners = new Set<(state: ConnectionState) => void>();
  let state: ConnectionState = 'connecting';
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let lastId: string | null = null;

  const setState = (next: ConnectionState) => {
    if (state === next) return;
    state = next;
    stateListeners.forEach((fn) => {
      fn(next);
    });
  };

  const deliver = (type: string, raw: MessageEvent) => {
    const message = raw as MessageEvent<string>;
    if (message.lastEventId) lastId = message.lastEventId;
    const data: unknown = (() => {
      try {
        return JSON.parse(message.data) as unknown;
      } catch {
        return null;
      }
    })();
    const event = { type, id: message.lastEventId, data };
    listeners.forEach((fn) => {
      fn(event);
    });
  };

  const open = () => {
    const Ctor = options.eventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource);
    if (!Ctor) return;
    // The browser resends Last-Event-ID on its own reconnects; a manual reopen passes it explicitly.
    const target = lastId ? `${url}?lastEventId=${encodeURIComponent(lastId)}` : url;
    const es = new Ctor(target);
    source = es;
    es.onopen = () => {
      attempt = 0;
      setState('connected');
    };
    es.onerror = () => {
      setState('reconnecting');
      if (es.readyState === 2 && source === es) {
        es.close();
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30000;
        attempt += 1;
        retryTimer = timer(() => {
          retryTimer = null;
          if (listeners.size + stateListeners.size > 0) open();
        }, delay);
      }
    };
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (e) => {
        deliver(type, e);
      });
    }
  };

  const close = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    source?.close();
    source = null;
    attempt = 0;
    state = 'connecting';
  };

  const sync = () => {
    const wanted = listeners.size + stateListeners.size > 0;
    if (wanted && !source && !retryTimer) open();
    if (!wanted && (source || retryTimer)) close();
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      sync();
      return () => {
        listeners.delete(fn);
        sync();
      };
    },
    onState(fn) {
      stateListeners.add(fn);
      sync();
      return () => {
        stateListeners.delete(fn);
        sync();
      };
    },
    state: () => state,
  };
}

/** Events client that never connects; used for mock data. */
export function createStaticEvents(state: ConnectionState = 'connected'): EventsClient {
  return {
    subscribe: () => () => undefined,
    onState: () => () => undefined,
    state: () => state,
  };
}
