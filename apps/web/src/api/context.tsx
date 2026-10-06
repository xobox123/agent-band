import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createApi } from './client.ts';
import type { Api } from './client.ts';
import { createEventsClient } from './events.ts';
import type { ConnectionState, EventsClient, ServerEvent } from './events.ts';

const ApiContext = createContext<Api | null>(null);
const EventsContext = createContext<EventsClient | null>(null);

export function ApiProvider({
  api,
  events,
  children,
}: {
  api?: Api;
  events?: EventsClient;
  children: ReactNode;
}) {
  const resolvedApi = useMemo(() => api ?? createApi(), [api]);
  const resolvedEvents = useMemo(() => events ?? createEventsClient(), [events]);
  return (
    <ApiContext.Provider value={resolvedApi}>
      <EventsContext.Provider value={resolvedEvents}>{children}</EventsContext.Provider>
    </ApiContext.Provider>
  );
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiProvider is missing');
  return api;
}

export function useEvents(): EventsClient {
  const events = useContext(EventsContext);
  if (!events) throw new Error('ApiProvider is missing');
  return events;
}

export function useConnectionState(): ConnectionState {
  const events = useEvents();
  const [state, setState] = useState(events.state());
  useEffect(() => {
    setState(events.state());
    return events.onState(setState);
  }, [events]);
  return state;
}

/** Calls `fn` (coalesced) when a matching server event arrives. A `reset` always matches. */
export function useServerEvents(prefixes: string[], fn: () => void, throttleMs = 400) {
  const events = useEvents();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const key = prefixes.join('|');
  useEffect(() => {
    const wanted = key.split('|');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = events.subscribe((event: ServerEvent) => {
      if (event.type !== 'reset' && !wanted.some((p) => event.type.startsWith(p))) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fnRef.current();
      }, throttleMs);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [events, key, throttleMs]);
}
