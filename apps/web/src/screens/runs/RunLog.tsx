import type { RunEventDto } from '@agent-band/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi, useServerEvents } from '../../api/context.tsx';
import { formatCost } from '../../lib/format.ts';
import { copyText } from '../../lib/format.ts';

const MAX_VIEW = 2000;

export function eventText(event: RunEventDto): string {
  const p = event.payload;
  switch (p.kind) {
    case 'text':
    case 'stderr':
      return p.text;
    case 'error':
      return p.message;
    case 'tool':
      return p.name;
    case 'usage':
      return `input ${String(p.inputTokens)}, output ${String(p.outputTokens)}, cached ${String(p.cachedTokens)}${
        p.costUsd === undefined ? '' : `, cost ${formatCost(p.costUsd)}`
      }`;
    case 'session':
      return `session ${p.sessionId}`;
    case 'rate_limit':
      return `${p.limitReached ? 'limit reached' : 'limit status'}${
        p.resetsAt ? `, resets ${new Date(p.resetsAt).toLocaleString()}` : ', reset time unknown'
      }`;
  }
}

export function RunEventLine({ event }: { event: RunEventDto }) {
  const p = event.payload as RunEventDto['payload'] | { kind: string };
  const time = new Date(event.ts).toLocaleTimeString();
  let body;
  if (p.kind === 'tool' && 'name' in p) {
    body = (
      <div>
        <span>{p.name}</span> <span className="badge badge-neutral">Decision unreported</span>
        {p.input === undefined ? null : (
          <details>
            <summary>Input</summary>
            <pre className="log-text">{JSON.stringify(p.input, null, 2).slice(0, 2000)}</pre>
          </details>
        )}
      </div>
    );
  } else if (p.kind === 'text' || p.kind === 'stderr' || p.kind === 'error') {
    body = <pre className="log-text">{eventText(event)}</pre>;
  } else if (p.kind === 'usage' || p.kind === 'session' || p.kind === 'rate_limit') {
    body = <span>{eventText(event)}</span>;
  } else {
    body = <pre className="log-text">{JSON.stringify(event.payload).slice(0, 2000)}</pre>;
  }
  return (
    <div className="log-line" data-kind={p.kind}>
      <time dateTime={event.ts} title={event.ts}>
        {time}
      </time>
      <span
        className={`badge badge-${p.kind === 'error' ? 'crit' : p.kind === 'tool' ? 'accent' : 'neutral'}`}
      >
        {p.kind}
      </span>
      {body}
    </div>
  );
}

export function RunLog({ runId }: { runId: string }) {
  const api = useApi();
  const [events, setEvents] = useState<RunEventDto[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [follow, setFollow] = useState(true);
  const lastId = useRef(0);
  const hidden = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const fetchMore = useCallback(() => {
    api.runs.events(runId, lastId.current).then(
      (page) => {
        if (page.items.length === 0) return;
        const last = page.items[page.items.length - 1];
        if (last) lastId.current = last.id;
        setError(null);
        setEvents((prev) => [...prev, ...page.items].slice(-MAX_VIEW));
      },
      (e: unknown) => {
        setError(e);
      },
    );
  }, [api, runId]);

  useEffect(() => {
    lastId.current = 0;
    hidden.current = 0;
    setEvents([]);
    setError(null);
    fetchMore();
  }, [fetchMore]);

  useServerEvents(['run.event', 'run.updated'], fetchMore, 200);

  useEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [events, follow]);

  const onScroll = () => {
    const el = scroller.current;
    if (el && follow && el.scrollHeight - el.scrollTop - el.clientHeight > 40) setFollow(false);
  };

  return (
    <div className="log">
      <div className="log-controls">
        <label className="inline-field">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked);
            }}
          />
          Follow
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setEvents([]);
          }}
        >
          Clear view
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            copyText(events.map((e) => `${e.ts} ${e.payload.kind} ${eventText(e)}`).join('\n'));
          }}
        >
          Copy visible text
        </button>
        <span className="dim">{`${String(events.length)} events`}</span>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {`Could not load run events. ${errorMessage(error)}`}{' '}
          <button type="button" className="btn" onClick={fetchMore}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="log-scroll" ref={scroller} onScroll={onScroll} role="log" aria-label="Run events">
        {events.length === 0 && !error ? <p className="dim">No events yet.</p> : null}
        {events.map((e) => (
          <RunEventLine key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}
