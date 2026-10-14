import type { RouteId } from '../router/routes.ts';

export type IconName = RouteId | 'moon' | 'sun';

const PATHS: Record<IconName, string[]> = {
  board: [
    'M4 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M11 4h4a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M18 4h2a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
  ],
  dashboard: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  agents: [
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5',
    'M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.2 2.6 3.5 5.5',
  ],
  'agent-groups': ['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  projects: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  tasks: ['M9 6h11M9 12h11M9 18h11', 'M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'],
  runs: ['M7 4.5v15l13-7.5z'],
  schedules: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  skills: ['M5 4a2 2 0 0 1 2-2h12v18H7a2 2 0 0 0-2 2z', 'M9 7h6M9 11h6'],
  policies: ['M12 3l8 3v6c0 4.5-3.3 8-8 9-4.7-1-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
  accounts: ['M3 6h18v12H3z', 'M3 10h18M7 15h4'],
  people: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6'],
  audit: ['M5 3h14v18H5z', 'M9 8h6M9 12h6M9 16h3'],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  ],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
};

export function NavIcon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="nav-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
