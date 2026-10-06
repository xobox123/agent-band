import { NAV_GROUPS } from '../router/routes.ts';
import type { RouteId } from '../router/routes.ts';

interface Props {
  route: RouteId;
  onNavigate: (id: RouteId) => void;
}

export function IconRail({ route, onNavigate }: Props) {
  return (
    <nav className="rail" aria-label="Sections">
      {NAV_GROUPS.map((group) => {
        const first = group.items[0];
        const active = group.items.some((item) => item.id === route);
        return (
          <button
            key={group.id}
            type="button"
            className={`rail-btn${active ? ' is-active' : ''}`}
            aria-label={group.label}
            aria-current={active ? 'true' : undefined}
            title={group.label}
            onClick={() => {
              if (first) onNavigate(first.id);
            }}
          >
            <span aria-hidden="true">{group.icon}</span>
          </button>
        );
      })}
    </nav>
  );
}
