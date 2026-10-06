import { useCallback, useState } from 'react';

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage is optional
  }
}

export function useStoredNumber(key: string, fallback: number): [number, (value: number) => void] {
  const [value, setValue] = useState(() => {
    const parsed = Number(readStorage(key));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  });
  const set = useCallback(
    (next: number) => {
      setValue(next);
      writeStorage(key, String(next));
    },
    [key],
  );
  return [value, set];
}
