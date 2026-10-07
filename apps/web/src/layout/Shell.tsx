import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useConnectionState } from '../api/context.tsx';
import { Dock } from '../components/Dock.tsx';
import { useHashRoute } from '../router/useHashRoute.ts';
import { ALL_ITEMS, routeLabel } from '../router/routes.ts';
import type { RouteId } from '../router/routes.ts';
import { useTheme } from '../theme/useTheme.ts';
import { Header } from './Header.tsx';
import { PauseBanner } from './PauseBanner.tsx';
import { IconRail } from './IconRail.tsx';
import { Sidebar } from './Sidebar.tsx';
import { WorkspaceContext } from './WorkspaceContext.tsx';
import type { DockSpec } from './WorkspaceContext.tsx';

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function Shell({ children }: { children: (route: RouteId) => ReactNode }) {
  const { route, navigate } = useHashRoute();
  const { theme, toggle } = useTheme();
  const connection = useConnectionState();
  const [detailsHost, setDetailsHost] = useState<HTMLElement | null>(null);
  const [dock, setDock] = useState<DockSpec | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaHeight, setAreaHeight] = useState(800);

  const openDock = useCallback((spec: DockSpec) => {
    setDock(spec);
  }, []);
  const closeDock = useCallback(() => {
    setDock(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && /^Digit[1-5]$/.test(event.code)) {
        const shortcut = event.code.slice(-1);
        const target = ALL_ITEMS.find((item) => item.shortcut === shortcut);
        if (target) {
          event.preventDefault();
          navigate(target.id);
        }
        return;
      }
      if (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        if (isTextInput(event.target)) return;
        const search = document.querySelector<HTMLElement>('[data-search]');
        if (search) {
          event.preventDefault();
          search.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [navigate]);

  useEffect(() => {
    const el = areaRef.current;
    if (el && el.clientHeight > 0) setAreaHeight(el.clientHeight);
  }, [dock]);

  const workspace = useMemo(
    () => ({ detailsHost, dock, openDock, closeDock, setItemCount: setCount }),
    [detailsHost, dock, openDock, closeDock],
  );

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="app">
        <p className="narrow-notice" role="note">
          This workspace requires a window at least 1024 px wide.
        </p>
        <div className="app-grid">
          <IconRail route={route} onNavigate={navigate} />
          <Sidebar route={route} theme={theme} onToggleTheme={toggle} />
          <div className="workspace" ref={areaRef}>
            <Header title={routeLabel(route)} count={count} connection={connection} />
            <PauseBanner />
            <div className="workspace-top">
              <main className="main" id="main">
                {children(route)}
              </main>
              <div className="details-host" ref={setDetailsHost} />
            </div>
            {dock ? (
              <Dock title={dock.title} onClose={closeDock} maxHeight={areaHeight}>
                {dock.body}
              </Dock>
            ) : null}
          </div>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
