import { NAV_GROUPS } from '../router/routes.ts';
import type { RouteId } from '../router/routes.ts';
import type { Theme } from '../theme/useTheme.ts';

interface Props {
  route: RouteId;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Sidebar({ route, theme, onToggleTheme }: Props) {
  return (
    <aside className="sidebar" aria-label="Resources">
      <div className="sidebar-brand">agent-band</div>
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
                    {item.label}
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
          <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
        </button>
      </footer>
    </aside>
  );
}
