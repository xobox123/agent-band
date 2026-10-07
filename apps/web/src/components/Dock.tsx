import { useCallback } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { CloseButton } from './CloseButton.tsx';
import { useEscape } from '../hooks/useEscape.ts';
import { useStoredNumber } from '../hooks/useStoredNumber.ts';

export const DOCK_KEY = 'agent-band.dock-height';
export const DOCK_DEFAULT = 240;
export const DOCK_MIN = 120;

interface Props {
  title: string;
  onClose: () => void;
  /** Height of the workspace, used for the 60% cap. */
  maxHeight?: number;
  children: ReactNode;
}

export function Dock({ title, onClose, maxHeight = 800, children }: Props) {
  const [stored, setHeight] = useStoredNumber(DOCK_KEY, DOCK_DEFAULT);
  const max = Math.max(DOCK_MIN, Math.floor(maxHeight * 0.6));
  const height = Math.min(max, Math.max(DOCK_MIN, stored));
  useEscape(1, true, onClose);

  const clamp = useCallback((value: number) => Math.min(max, Math.max(DOCK_MIN, Math.round(value))), [max]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const startH = height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      setHeight(clamp(startH + (startY - e.clientY)));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp') setHeight(clamp(height + 24));
    if (event.key === 'ArrowDown') setHeight(clamp(height - 24));
  };

  return (
    <section className="dock" aria-label={title} style={{ height }}>
      <div
        className="dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize dock"
        aria-valuemin={DOCK_MIN}
        aria-valuemax={max}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <header className="dock-head">
        <strong>{title}</strong>
        <CloseButton onClick={onClose} />
      </header>
      <div className="dock-body">{children}</div>
    </section>
  );
}
