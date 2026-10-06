import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, colorOf, initialsOf } from './Avatar.tsx';
import { LimitBar } from './LimitBar.tsx';
import { StatusDot } from './StatusDot.tsx';
import { statusInfo, statusValues } from './statusInfo.ts';
import type { StatusKind } from './statusInfo.ts';
import { Table } from './Table.tsx';
import type { Column } from './Table.tsx';

describe('StatusDot', () => {
  const expected: Record<string, [string, string]> = {
    'task:queued': ['Queued', '--muted'],
    'task:claimed': ['Claimed', '--warn'],
    'task:running': ['Running', '--ok'],
    'task:done': ['Done', '--ok'],
    'task:failed': ['Failed', '--crit'],
    'task:rate_limited': ['Rate limited', '--warn'],
    'task:cancelled': ['Cancelled', '--text-dim'],
    'task:denied': ['Denied', '--crit'],
    'run:running': ['Running', '--ok'],
    'run:done': ['Done', '--ok'],
    'run:failed': ['Failed', '--crit'],
    'run:rate_limited': ['Rate limited', '--warn'],
    'run:cancelled': ['Cancelled', '--text-dim'],
    'agent:enabled': ['Enabled', '--ok'],
    'agent:disabled': ['Disabled', '--text-dim'],
    'user:active': ['Active', '--ok'],
    'user:disabled': ['Disabled', '--text-dim'],
  };

  it.each(Object.entries(expected))('maps %s', (id, [label, token]) => {
    const [kind, value] = id.split(':') as [StatusKind, string];
    expect(statusInfo(kind, value)).toEqual({ label, token });
    const { container } = render(<StatusDot kind={kind} value={value} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector('.status-dot')).toHaveAttribute('data-token', token);
  });

  it('covers every lifecycle value in the vocabulary', () => {
    const covered = (['task', 'run', 'agent', 'user'] as const).flatMap((k) =>
      statusValues(k).map((v) => `${k}:${v}`),
    );
    expect(covered.sort()).toEqual(Object.keys(expected).sort());
  });

  it('keeps the label for assistive technology in dot-only mode', () => {
    render(<StatusDot kind="task" value="failed" dotOnly />);
    expect(screen.getByText('Failed')).toHaveClass('sr-only');
  });
});

interface Row {
  id: string;
  name: string;
  n: number;
}
const rows: Row[] = [
  { id: 'a', name: 'Charlie', n: 2 },
  { id: 'b', name: 'Alpha', n: 10 },
  { id: 'c', name: 'Bravo', n: 1 },
];
const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
  { id: 'n', header: 'Count', cell: (r) => r.n, sortValue: (r) => r.n },
  { id: 'static', header: 'Static', cell: () => 'x' },
];

const names = () =>
  within(screen.getByRole('table', { name: 'Things' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent);

describe('Table', () => {
  it('sorts by column and toggles direction', () => {
    render(<Table label="Things" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(names()).toEqual(['Charlie', 'Alpha', 'Bravo']);
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    expect(names()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    fireEvent.click(screen.getByRole('button', { name: /^Count/ }));
    expect(names()).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });

  it('has no sort control for non-sortable columns', () => {
    render(<Table label="Things" columns={columns} rows={rows} getRowId={(r) => r.id} />);
    expect(screen.queryByRole('button', { name: 'Static' })).not.toBeInTheDocument();
  });

  it('selects a row on click and opens on Enter', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <Table
        label="Things"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        selectedId="b"
        onSelect={onSelect}
        onOpen={onOpen}
      />,
    );
    const row = screen.getByRole('row', { name: /Alpha/ });
    expect(row).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('row', { name: /Bravo/ }));
    expect(onSelect).toHaveBeenCalledWith(rows[2]);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });
});

describe('Avatar and LimitBar', () => {
  it('derives initials and a stable colour', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('linus')).toBe('LI');
    expect(colorOf('Ada')).toBe(colorOf('Ada'));
    render(<Avatar name="Grace" />);
    expect(screen.getByRole('img', { name: 'Grace' })).toHaveTextContent('GR');
  });

  it('falls back to initials when the image is broken', () => {
    render(<Avatar name="Grace" avatar={{ url: 'https://example.invalid/a.png' }} />);
    fireEvent.error(screen.getByRole('img', { name: 'Grace' }));
    expect(screen.getByRole('img', { name: 'Grace' })).toHaveTextContent('GR');
  });

  it('shows a progress bar or "No snapshot"', () => {
    const { rerender } = render(<LimitBar value={42} label="5h" />);
    expect(screen.getByRole('progressbar', { name: '5h' })).toHaveAttribute('aria-valuenow', '42');
    rerender(<LimitBar value={null} label="5h" />);
    expect(screen.getByText('5h: No snapshot')).toBeInTheDocument();
  });
});
