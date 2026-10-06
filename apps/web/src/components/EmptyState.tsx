import type { ReactNode } from 'react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: Props) {
  return (
    <div className="state state-empty">
      <p className="state-title">{title}</p>
      {description ? <p className="dim">{description}</p> : null}
      {action}
    </div>
  );
}
