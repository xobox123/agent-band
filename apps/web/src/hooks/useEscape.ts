import { useEffect } from 'react';

interface Entry {
  priority: number;
  handler: () => void;
}

const entries = new Set<Entry>();
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || entries.size === 0) return;
  let top: Entry | undefined;
  for (const entry of entries) {
    if (!top || entry.priority >= top.priority) top = entry;
  }
  top?.handler();
}

/**
 * Escape dismisses the topmost layer only: drag 4, form/dialog 3, details 2, dock 1.
 */
export function useEscape(priority: number, active: boolean, handler: () => void) {
  useEffect(() => {
    if (!active) return;
    const entry: Entry = { priority, handler };
    entries.add(entry);
    if (!listening) {
      document.addEventListener('keydown', onKeyDown);
      listening = true;
    }
    return () => {
      entries.delete(entry);
      if (entries.size === 0) {
        document.removeEventListener('keydown', onKeyDown);
        listening = false;
      }
    };
  }, [priority, active, handler]);
}
