import type { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

export function Toolbar({ label, children }: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}
