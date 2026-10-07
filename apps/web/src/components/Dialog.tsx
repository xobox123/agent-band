import type { ReactNode, Ref } from 'react';
import { CloseButton } from './CloseButton.tsx';

interface Props {
  /** Accessible name; ignored when `labelledBy` is given. */
  label?: string;
  labelledBy?: string;
  /** Extra class names for the dialog box. */
  className?: string;
  /** Called by the "×" button and by a click on the backdrop. */
  onClose: () => void;
  boxRef?: Ref<HTMLDivElement>;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  children: ReactNode;
}

/** Modal frame shared by every dialog: backdrop, box and a top-right close button. */
export function Dialog({ label, labelledBy, className = '', onClose, boxRef, onKeyDown, children }: Props) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': label })}
        ref={boxRef}
        {...(onKeyDown ? { onKeyDown } : {})}
      >
        <CloseButton className="dialog-close" onClick={onClose} />
        {children}
      </div>
    </div>
  );
}
