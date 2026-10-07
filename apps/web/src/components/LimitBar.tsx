interface Props {
  /** Used percentage 0-100, or null when no snapshot exists. */
  value: number | null;
  label: string;
  title?: string;
  /** Reserve threshold (0-100) drawn as a marker line. */
  marker?: number | undefined;
  /** Old reading; rendered dimmed. */
  stale?: boolean | undefined;
}

export function LimitBar({ value, label, title, marker, stale }: Props) {
  if (value === null) {
    return (
      <span
        role="img"
        className="limit-bar dim"
        title={title ?? `${label}: no snapshot`}
        aria-label={`${label}: No snapshot`}
      >
        No data
      </span>
    );
  }
  const pct = Math.min(100, Math.max(0, value));
  const tone = pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
  return (
    <span className={`limit-bar${stale ? ' limit-stale' : ''}`} title={title}>
      <span className="limit-track-wrap">
        <span
          className="limit-track"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
        >
          <span className={`limit-fill limit-${tone}`} style={{ width: `${pct}%` }} />
        </span>
        {marker !== undefined ? (
          <span
            className="limit-marker"
            role="img"
            aria-label={`${label} stops new work at ${String(marker)}%`}
            title={`Stops new work at ${String(marker)}%`}
            style={{ left: `${String(Math.min(100, marker))}%` }}
          />
        ) : null}
      </span>
      <span className="limit-text">{Math.round(pct)}%</span>
    </span>
  );
}
