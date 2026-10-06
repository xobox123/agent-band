import { createPortal } from 'react-dom';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useEscape } from '../hooks/useEscape.ts';
import { useWorkspace } from '../layout/WorkspaceContext.tsx';

interface Props {
  title: string;
  /** ID or key shown under the title. */
  subtitle?: string;
  onClose: () => void;
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function DetailsPanel({ title, subtitle, onClose, banner, footer, children }: Props) {
  const { detailsHost } = useWorkspace();
  const ref = useRef<HTMLElement>(null);
  useEscape(2, true, onClose);

  const panel = (
    <aside className="details" aria-label={`${title} details`} ref={ref}>
      <header className="details-head">
        <div>
          <h2 className="details-title">{title}</h2>
          {subtitle ? <div className="mono dim">{subtitle}</div> : null}
        </div>
        <button type="button" className="btn btn-icon" aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </header>
      {banner ? <div className="details-banner">{banner}</div> : null}
      <div className="details-body">{children}</div>
      {footer ? <footer className="details-foot">{footer}</footer> : null}
    </aside>
  );

  return detailsHost ? createPortal(panel, detailsHost) : panel;
}
