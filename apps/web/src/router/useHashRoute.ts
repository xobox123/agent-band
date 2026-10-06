import { useCallback, useEffect, useState } from 'react';
import { parseHash } from './routes.ts';
import type { RouteId } from './routes.ts';

export function navigate(id: RouteId) {
  window.location.hash = `#/${id}`;
}

export function useHashRoute(): { route: RouteId; navigate: (id: RouteId) => void } {
  const [route, setRoute] = useState<RouteId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  const go = useCallback((id: RouteId) => {
    navigate(id);
  }, []);
  return { route, navigate: go };
}
