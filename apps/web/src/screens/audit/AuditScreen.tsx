import type { AuditEventDto, AuditVerifyDto } from '@agent-band/contracts';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import type { AuditFilter } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { ErrorState } from '../../components/ErrorState.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { Table } from '../../components/Table.tsx';
import type { Column } from '../../components/Table.tsx';
import { Toolbar } from '../../components/Toolbar.tsx';
import { useItemCount } from '../../layout/WorkspaceContext.tsx';
import { formatTime, shortId } from '../../lib/format.ts';

const PAGE = 50;

export function AuditScreen() {
  const api = useApi();
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<AuditFilter>({});
  const [items, setItems] = useState<AuditEventDto[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [verify, setVerify] = useState<AuditVerifyDto | 'pending' | 'failed' | null>(null);

  const fetchPage = useCallback(
    (filter: AuditFilter, cursor: number | undefined, append: boolean) => {
      setLoading(true);
      api.audit.list({ ...filter, limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }).then(
        (page) => {
          setItems((prev) => (append ? [...prev, ...page.items] : page.items));
          setNext(page.nextCursor);
          setError(null);
          setLoading(false);
        },
        (e: unknown) => {
          setError(e);
          setLoading(false);
        },
      );
    },
    [api],
  );

  useEffect(() => {
    fetchPage(applied, undefined, false);
  }, [applied, fetchPage]);
  useItemCount(items.length);

  const apply = () => {
    const filter: AuditFilter = {};
    if (action.trim()) filter.action = action.trim();
    if (targetType.trim()) filter.targetType = targetType.trim();
    if (targetId.trim()) filter.targetId = targetId.trim();
    if (from) filter.from = new Date(from).toISOString();
    if (to) filter.to = new Date(to).toISOString();
    setApplied(filter);
  };
  const clear = () => {
    setAction('');
    setTargetType('');
    setTargetId('');
    setFrom('');
    setTo('');
    setApplied({});
  };

  const runVerify = () => {
    setVerify('pending');
    api.audit.verify().then(setVerify, () => {
      setVerify('failed');
    });
  };

  const columns: Column<AuditEventDto>[] = [
    { id: 'seq', header: 'Seq', width: 70, cell: (e) => String(e.seq) },
    { id: 'ts', header: 'Time', cell: (e) => formatTime(e.ts) },
    { id: 'action', header: 'Action', cell: (e) => <span className="mono">{e.action}</span> },
    { id: 'actor', header: 'Actor', cell: (e) => <span className="mono">{shortId(e.actorId)}</span> },
    {
      id: 'target',
      header: 'Target',
      cell: (e) => `${e.targetType} ${e.targetId.length > 12 ? shortId(e.targetId) : e.targetId}`,
    },
  ];
  const event = items.find((e) => e.seq === selected);
  const filtered = Object.keys(applied).length > 0;

  return (
    <div className="screen">
      <Toolbar label="Audit toolbar">
        <input
          className="field"
          aria-label="Action"
          placeholder="Action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
          }}
        />
        <input
          className="field"
          aria-label="Target type"
          placeholder="Target type"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
          }}
        />
        <input
          className="field"
          aria-label="Target ID"
          placeholder="Target ID"
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
          }}
        />
        <input
          className="field"
          type="datetime-local"
          aria-label="From"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
          }}
        />
        <input
          className="field"
          type="datetime-local"
          aria-label="To"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
          }}
        />
        <button type="button" className="btn btn-primary" onClick={apply}>
          Apply filters
        </button>
        <button type="button" className="btn" onClick={clear}>
          Clear filters
        </button>
        <button type="button" className="btn" onClick={runVerify} disabled={verify === 'pending'}>
          Verify chain
        </button>
        {verify && verify !== 'pending' && verify !== 'failed' ? (
          <span role="status" title={`${String(verify.count)} events checked`}>
            {verify.ok ? (
              <StatusDot kind="indicator" value="ok" />
            ) : (
              <>
                <StatusDot kind="indicator" value="broken" /> {`at seq ${String(verify.brokenAtSeq ?? '?')}`}
              </>
            )}
          </span>
        ) : null}
        {verify === 'failed' ? <span role="status">Verification failed to run.</span> : null}
        <a className="btn" href={api.audit.exportUrl(applied)} download="audit.jsonl">
          Export JSONL
        </a>
      </Toolbar>
      <div className="screen-body">
        {error && items.length === 0 ? (
          <ErrorState
            message="Could not load audit events. Retry."
            onRetry={() => {
              fetchPage(applied, undefined, false);
            }}
          />
        ) : items.length === 0 && !loading ? (
          <EmptyState
            title={filtered ? 'No matches. Clear filters to see all items.' : 'No audit events yet.'}
          />
        ) : (
          <>
            <Table
              label="Audit events"
              columns={columns}
              rows={items}
              getRowId={(e) => String(e.seq)}
              selectedId={selected === null ? null : String(selected)}
              onSelect={(e) => {
                setSelected(e.seq);
              }}
            />
            {error ? (
              <p className="form-error" role="alert">
                {errorMessage(error)}
              </p>
            ) : null}
            {next !== null ? (
              <div className="section-pad">
                <button
                  type="button"
                  className="btn"
                  disabled={loading}
                  onClick={() => {
                    fetchPage(applied, next, true);
                  }}
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {event ? (
        <DetailsPanel
          title={event.action}
          subtitle={`seq ${String(event.seq)}`}
          onClose={() => {
            setSelected(null);
          }}
        >
          <dl className="kv">
            <dt>Time</dt>
            <dd>{formatTime(event.ts)}</dd>
            <dt>Actor</dt>
            <dd className="mono-wrap">{event.actorId}</dd>
            <dt>Target</dt>
            <dd className="mono-wrap">{`${event.targetType} ${event.targetId}`}</dd>
            <dt>Hash</dt>
            <dd className="mono-wrap">{event.hash}</dd>
            <dt>Previous hash</dt>
            <dd className="mono-wrap">{event.prevHash}</dd>
          </dl>
          <h3 className="section-title">Data</h3>
          <pre className="prompt">{JSON.stringify(event.data, null, 2)}</pre>
        </DetailsPanel>
      ) : null}
    </div>
  );
}
