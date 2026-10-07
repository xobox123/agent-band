interface Props {
  /** Row label shown in the first column. */
  name: string;
  /** Used percentage 0-100, or null when no snapshot exists. */
  value: number | null;
  /** Accessible label of the bar. */
  label: string;
  title?: string;
  /** Reserve threshold (0-100) drawn as a marker line. */
  marker?: number | undefined;
  /** Old reading; rendered dimmed. */
  stale?: boolean | undefined;
  /** Reset text such as "resets in 4d 13h"; a dimmed placeholder is shown when missing. */
  reset?: string | null | undefined;
  resetTitle?: string | undefined;
}

/** One limit row: label | bar | percent | reset text. Every limit in the app renders through this grid. */
export function LimitBar({ name, value, label, title, marker, stale, reset, resetTitle }: Props) {
  const pct = value === null ? null : Math.min(100, Math.max(0, value));
  const tone = pct === null ? 'ok' : pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
  return (
    <div className={`limit-row${stale ? ' limit-stale' : ''}`} title={title}>
      <span className="limit-name" title={name}>
        {name}
      </span>
      <span className="limit-track-wrap">
        {pct === null ? (
          <span
            className="limit-track"
            role="img"
            aria-label={`${label}: No snapshot`}
            title={`${label}: no snapshot`}
          />
        ) : (
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
        )}
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
      <span className={`limit-text${pct === null ? ' dim' : ''}`}>
        {pct === null ? '–' : `${String(Math.round(pct))}%`}
      </span>
      <span className={`limit-reset${reset ? '' : ' dim limit-reset-missing'}`} title={resetTitle}>
        {reset ?? 'no reset info'}
      </span>
    </div>
  );
}
