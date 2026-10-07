import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { createMockDataSource } from '../data/mock.ts';
import { list, testApi } from '../test-utils.tsx';
import { ALL_ITEMS, parseHash } from './routes.ts';

const source = () => createMockDataSource({ live: false, latencyMs: 0 });

describe('router', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('parses hashes and falls back to the board', () => {
    expect(parseHash('')).toBe('board');
    expect(parseHash('#/runs')).toBe('runs');
    expect(parseHash('#/agent-groups')).toBe('agent-groups');
    expect(parseHash('#/nope')).toBe('board');
  });

  it('lists every sidebar item from the spec', () => {
    render(<App dataSource={source()} />);
    for (const label of [
      'Board',
      'Dashboard',
      'Agents',
      'Agent groups',
      'Tasks',
      'Runs',
      'Schedules',
      'Skills',
      'Policies',
      'Accounts',
      'People and teams',
      'Audit',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(ALL_ITEMS).toHaveLength(13);
  });

  it('renders the selected screen and follows hash changes', async () => {
    window.location.hash = '#/agents';
    const { api } = testApi({
      'GET /agents': list([]),
      'GET /accounts': list([]),
      'GET /agent-groups': list([]),
      'GET /policies': list([]),
      'GET /runs': list([]),
      'GET /audit': { items: [], nextCursor: null, cursor: 0 },
    });
    render(<App dataSource={source()} api={api} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
    expect(await screen.findByText('No agents yet. Create an agent.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page');

    await act(async () => {
      window.location.hash = '#/audit';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Audit' })).toBeInTheDocument();
  });

  it('navigates with Alt+digit shortcuts', async () => {
    const { api } = testApi({
      'GET /agents': list([]),
      'GET /accounts': list([]),
      'GET /agent-groups': list([]),
      'GET /policies': list([]),
      'GET /runs': list([]),
    });
    render(<App dataSource={source()} api={api} />);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', altKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
  });
});
