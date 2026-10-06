export type RouteId =
  | 'board'
  | 'dashboard'
  | 'agents'
  | 'agent-groups'
  | 'tasks'
  | 'runs'
  | 'skills'
  | 'policies'
  | 'accounts'
  | 'people'
  | 'audit';

export interface NavItem {
  id: RouteId;
  label: string;
  /** Alt+<digit> shortcut. */
  shortcut?: string;
}

export interface NavGroup {
  id: 'workspace' | 'execution' | 'governance';
  label: string;
  /** Glyph for the icon rail. */
  icon: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    icon: '▦',
    items: [
      { id: 'board', label: 'Board', shortcut: '1' },
      { id: 'dashboard', label: 'Dashboard', shortcut: '2' },
    ],
  },
  {
    id: 'execution',
    label: 'Execution',
    icon: '▶',
    items: [
      { id: 'agents', label: 'Agents', shortcut: '3' },
      { id: 'agent-groups', label: 'Agent groups' },
      { id: 'tasks', label: 'Tasks', shortcut: '4' },
      { id: 'runs', label: 'Runs', shortcut: '5' },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: '⛨',
    items: [
      { id: 'skills', label: 'Skills' },
      { id: 'policies', label: 'Policies' },
      { id: 'accounts', label: 'Accounts' },
      { id: 'people', label: 'People and teams' },
      { id: 'audit', label: 'Audit' },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const DEFAULT_ROUTE: RouteId = 'board';

export function parseHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return ALL_ITEMS.find((item) => item.id === id)?.id ?? DEFAULT_ROUTE;
}

export function routeLabel(id: RouteId): string {
  return ALL_ITEMS.find((item) => item.id === id)?.label ?? id;
}
