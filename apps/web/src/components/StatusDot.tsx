import { statusInfo } from './statusInfo.ts';
import type { StatusKind } from './statusInfo.ts';

interface Props {
  kind: StatusKind;
  value: string;
  /** Hide the text label (the label stays available to assistive technology). */
  dotOnly?: boolean;
}

export function StatusDot({ kind, value, dotOnly = false }: Props) {
  const info = statusInfo(kind, value);
  return (
    <span className="status" data-status={value}>
      <span
        className="status-dot"
        aria-hidden="true"
        style={{ background: `var(${info.token})` }}
        data-token={info.token}
      />
      <span className={dotOnly ? 'sr-only' : undefined}>{info.label}</span>
    </span>
  );
}
