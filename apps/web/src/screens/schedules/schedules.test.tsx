import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { agentDto, ID, list, Providers, scheduleDto, taskDto, testApi } from '../../test-utils.tsx';
import type { Routes } from '../../test-utils.tsx';
import { SchedulesScreen } from './SchedulesScreen.tsx';

const org = {
  id: ID(100),
  name: 'Acme',
  taskKeyPrefix: 'AB',
  timezone: 'Europe/Warsaw',
  policyId: null,
  createdAt: '',
};

function routes(
  extra: Routes = {},
  schedules = [scheduleDto({ lastTaskId: ID(30), lastFiredAt: '2026-10-06T07:00:00.000Z' })],
): Routes {
  return {
    'GET /schedules': list(schedules),
    'GET /organization': org,
    'GET /agents': list([agentDto()]),
    'GET /agent-groups': list([]),
    [`GET /schedules/${ID(50)}/tasks`]: list([
      taskDto({ id: ID(30), key: 'AB-7', title: 'Audit run', status: 'done', scheduleId: ID(50) }),
    ]),
    'GET /schedules/preview': { fireTimes: ['2026-10-07T07:00:00.000Z', '2026-10-08T07:00:00.000Z'] },
    ...extra,
  };
}

function setup(r: Routes) {
  const { api, calls } = testApi(r);
  render(
    <Providers api={api}>
      <SchedulesScreen />
    </Providers>,
  );
  return calls;
}

describe('Schedules screen', () => {
  it('lists schedules with cron in words and last task status', async () => {
    setup(routes());
    const table = await screen.findByRole('table', { name: 'Schedules' });
    const row = within(table).getByRole('row', { name: /Nightly audit/ });
    expect(within(row).getByText(/Every weekday at 09:00/)).toBeInTheDocument();
    expect(within(row).getByText('Done')).toBeInTheDocument();
    expect(within(row).getByRole('switch', { name: 'Enabled Nightly audit' })).toBeChecked();
  });

  it('shows the details panel with template and task history', async () => {
    setup(routes());
    fireEvent.click(await screen.findByRole('row', { name: /Nightly audit/ }));
    const panel = await screen.findByRole('complementary', { name: 'Nightly audit details' });
    expect(within(panel).getByText('Check advisories')).toBeInTheDocument();
    expect(within(panel).getByText(/Organization \(Europe\/Warsaw\)/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /AB-7 Audit run/ })).toHaveAttribute(
      'href',
      `#/board?task=${ID(30)}`,
    );
  });

  it('toggles enabled through PATCH', async () => {
    const calls = setup(routes({ [`PATCH /schedules/${ID(50)}`]: scheduleDto({ enabled: false }) }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Enabled Nightly audit' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false });
    });
  });

  it('runs a schedule now', async () => {
    const calls = setup(
      routes({ [`POST /schedules/${ID(50)}/run-now`]: taskDto({ id: ID(31), key: 'AB-8' }) }),
    );
    fireEvent.click(await screen.findByRole('row', { name: /Nightly audit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    expect(await screen.findByRole('link', { name: 'AB-8' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/run-now'))).toBe(true);
  });

  it('deletes after confirmation', async () => {
    const calls = setup(routes({ [`DELETE /schedules/${ID(50)}`]: null }));
    fireEvent.click(await screen.findByRole('row', { name: /Nightly audit/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('creates a schedule with a live preview', async () => {
    const calls = setup(routes({ 'POST /schedules': scheduleDto({ id: ID(51), name: 'Weekly' }) }, []));
    fireEvent.click(await screen.findByRole('button', { name: 'Create schedule' }));
    const dialog = await screen.findByRole('dialog', { name: 'New schedule' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Monday 9:00' }));
    const preview = await within(dialog).findByRole('list', {}, { timeout: 2000 });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(2);
    const previewCall = calls.filter((c) => c.path === '/schedules/preview').at(-1);
    expect(previewCall).toBeDefined();

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Weekly' } });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Report' } });
    fireEvent.change(within(dialog).getByLabelText(/^Project folder/), { target: { value: '/work' } });
    fireEvent.change(within(dialog).getByLabelText(/^Prompt/), { target: { value: 'Summarise' } });
    fireEvent.change(within(dialog).getByLabelText(/^Agent/), { target: { value: ID(1) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Weekly',
        enabled: true,
        cron: '0 9 * * 1',
        template: {
          title: 'Report',
          prompt: 'Summarise',
          workDir: '/work',
          target: { agentId: ID(1) },
          priority: 2,
        },
        overlap: 'skip',
      });
    });
  });
});
