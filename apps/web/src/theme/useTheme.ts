import { useCallback, useEffect, useState } from 'react';
import { readStorage, writeStorage } from '../hooks/useStoredNumber.ts';

export type Theme = 'dark' | 'light';
export const THEME_KEY = 'agent-band.theme';

function initialTheme(): Theme {
  return readStorage(THEME_KEY) === 'light' ? 'light' : 'dark';
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      writeStorage(THEME_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggle };
}
