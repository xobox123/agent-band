import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'crit' | 'accent';

interface Props {
  tone?: BadgeTone;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', title, children }: Props) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}
