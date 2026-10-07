import { useEffect, useRef } from 'react';
import { Dialog } from './Dialog.tsx';
import { useEscape } from '../hooks/useEscape.ts';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Keep task',
  busy = false,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEscape(3, true, onCancel);

  useEffect(() => {
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  const trap = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <Dialog labelledBy="dialog-title" onClose={onCancel} onKeyDown={trap}>
      <h2 id="dialog-title" className="dialog-title">
        {title}
      </h2>
      <p>{message}</p>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="btn btn-danger" ref={confirmRef} disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
