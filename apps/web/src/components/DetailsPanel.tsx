import { createPortal } from 'react-dom';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseButton } from './CloseButton.tsx';
import { useEscape } from '../hooks/useEscape.ts';
import { useWorkspace } from '../layout/WorkspaceContext.tsx';

interface Props {
  title: string;
  /** Short descriptor shown under the title. */
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
          {subtitle ? <div className="dim">{subtitle}</div> : null}
        </div>
        <CloseButton onClick={onClose} />
      </header>
      {banner ? <div className="details-banner">{banner}</div> : null}
      <div className="details-body">{children}</div>
      {footer ? <footer className="details-foot">{footer}</footer> : null}
    </aside>
  );

  return detailsHost ? createPortal(panel, detailsHost) : panel;
}
