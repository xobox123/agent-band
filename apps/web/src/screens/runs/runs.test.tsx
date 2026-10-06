import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ID,
  NOW,
  Providers,
  accountDto,
  agentDto,
  list,
  runDto,
  taskDto,
  testApi,
} from '../../test-utils.tsx';
import { RunLog } from './RunLog.tsx';
import { RunsScreen } from './RunsScreen.tsx';

const ev = (id: number, payload: Record<string, unknown>) => ({
  id,
  runId: ID(40),
  ts: NOW,
  kind: String(payload.kind),
  payload,
});

describe('RunLog', () => {
  it('renders each event kind distinctly', async () => {
    const { api } = testApi({
      [`GET /runs/${ID(40)}/events`]: list([
        ev(1, { kind: 'text', text: '<b>hello</b> world' }),
        ev(2, { kind: 'tool', name: 'Bash', input: { command: 'ls' } }),
        ev(3, { kind: 'error', message: 'boom' }),
        ev(4, { kind: 'usage', inputTokens: 10, outputTokens: 5, cachedTokens: 2, costUsd: 0.0123 }),
        ev(5, { kind: 'stderr', text: 'warn line' }),
        ev(6, { kind: 'session', sessionId: 'sess-1' }),
        ev(7, { kind: 'rate_limit', windows: [], limitReached: true, resetsAt: NOW }),
        ev(8, { kind: 'brand_new', foo: 1 }),
      ]),
    });
    render(
      <Providers api={api}>
        <RunLog runId={ID(40)} />
      </Providers>,
    );
    const log = await screen.findByRole('log', { name: 'Run events' });
    await waitFor(() => {
      expect(log.querySelectorAll('.log-line')).toHaveLength(8);
    });
    const line = (kind: string) => log.querySelector<HTMLElement>(`[data-kind="${kind}"]`) as HTMLElement;
    expect(line('text')).toHaveTextContent('<b>hello</b> world');
    expect(line('text').querySelector('b')).toBeNull();
    expect(line('tool')).toHaveTextContent('Bash');
    expect(line('tool')).toHaveTextContent('Decision unreported');
    expect(line('tool').querySelector('pre')?.textContent).toContain('"command": "ls"');
    expect(line('error')).toHaveTextContent('boom');
    expect(line('usage')).toHaveTextContent('input 10, output 5, cached 2, cost $0.0123');
    expect(line('stderr')).toHaveTextContent('warn line');
    expect(line('session')).toHaveTextContent('session sess-1');
    expect(line('rate_limit')).toHaveTextContent('limit reached');
    expect(line('brand_new')).toHaveTextContent('"foo":1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear view' }));
    expect(log.querySelectorAll('.log-line')).toHaveLength(0);
  });

  it('shows a retryable error when events cannot be loaded', async () => {
    const { api } = testApi({});
    render(
      <Providers api={api}>
        <RunLog runId={ID(40)} />
      </Providers>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load run events.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Runs screen', () => {
  const routes = {
    'GET /runs': list([runDto(), runDto({ id: ID(41), status: 'failed', error: 'exit 1' })]),
    'GET /agents': list([agentDto()]),
    'GET /accounts': list([accountDto()]),
    'GET /tasks': list([taskDto()]),
    [`GET /runs/${ID(40)}/events`]: list([ev(1, { kind: 'text', text: 'streamed line' })]),
  };

  it('lists runs and opens details with the live log in the dock', async () => {
    const { api } = testApi(routes);
    render(
      <Providers api={api}>
        <RunsScreen />
      </Providers>,
    );
    const table = await screen.findByRole('table', { name: 'Runs' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByText('AB-1', { selector: 'td' })).toHaveLength(2);
    fireEvent.click(within(table).getAllByText('Running')[0] as HTMLElement);
    const details = await screen.findByRole('complementary', { name: /^Run .* details$/ });
    expect(within(details).getByText(/Input 1,200/)).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: 'Open logs' })).toBeInTheDocument();
  });

  it('shows the empty state and filters by status through the API', async () => {
    const { api, calls } = testApi({ ...routes, 'GET /runs': list([]) });
    render(
      <Providers api={api}>
        <RunsScreen />
      </Providers>,
    );
    expect(await screen.findByText('No runs yet. Runs appear when tasks start.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'failed' } });
    await waitFor(() => {
      expect(calls.filter((c) => c.path === '/runs').length).toBeGreaterThan(1);
    });
  });
});
