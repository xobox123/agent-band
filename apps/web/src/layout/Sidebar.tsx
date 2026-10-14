import { NAV_GROUPS } from '../router/routes.ts';
import type { RouteId } from '../router/routes.ts';
import type { Theme } from '../theme/useTheme.ts';
import { NavIcon } from './NavIcon.tsx';

interface Props {
  route: RouteId;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Sidebar({ route, theme, onToggleTheme }: Props) {
  return (
    <aside className="sidebar" aria-label="Resources">
      <div className="sidebar-brand">
        <span>agent-band</span>
        <span className="sidebar-tag">local</span>
      </div>
      <nav className="sidebar-nav" aria-label="Resources">
        {NAV_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`nav-${group.id}`}>
            <h2 className="sidebar-heading" id={`nav-${group.id}`}>
              {group.label}
            </h2>
            <ul className="sidebar-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#/${item.id}`}
                    className={`sidebar-link${route === item.id ? ' is-active' : ''}`}
                    aria-current={route === item.id ? 'page' : undefined}
                    title={item.shortcut ? `${item.label} (Alt+${item.shortcut})` : item.label}
                  >
                    <NavIcon name={item.id} />
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <footer className="sidebar-foot">
        <span className="mono dim">user:local</span>
        <button
          type="button"
          className="btn btn-icon"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title="Toggle theme"
          onClick={onToggleTheme}
        >
          <NavIcon name={theme === 'dark' ? 'moon' : 'sun'} />
        </button>
      </footer>
    </aside>
  );
}
