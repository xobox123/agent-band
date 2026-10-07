import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsScreen } from '../screens/settings/SettingsScreen.tsx';
import { Providers, testApi } from '../test-utils.tsx';
import { PauseBanner, PauseButton } from './PauseBanner.tsx';

const org = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  name: 'Default',
  taskKeyPrefix: 'AB',
  timezone: 'UTC',
  policyId: null,
  paused: false,
  workspaceRoot: '/home/u/agent-band/workspaces',
  createdAt: '2026-10-07T00:00:00.000Z',
  ...over,
});

describe('pause banner', () => {
  it('shows nothing while the organization runs', async () => {
    const { api, calls } = testApi({ 'GET /organization': org() });
    render(
      <Providers api={api}>
        <PauseBanner />
        <PauseButton />
      </Providers>,
    );
    await screen.findByRole('button', { name: 'Pause all' });
    expect(screen.queryByText(/Paused\./)).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('pauses the organization from the header button', async () => {
    let paused = false;
    const { api, calls } = testApi({
      'GET /organization': () => org({ paused }),
      'PUT /organization/pause': () => {
        paused = true;
        return org({ paused });
      },
    });
    render(
      <Providers api={api}>
        <PauseBanner />
        <PauseButton />
      </Providers>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Pause all' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ paused: true });
    });
  });

  it('shows a global banner while paused and resumes from it', async () => {
    let paused = true;
    const { api, calls } = testApi({
      'GET /organization': () => org({ paused }),
      'PUT /organization/pause': () => {
        paused = false;
        return org({ paused });
      },
    });
    render(
      <Providers api={api}>
        <PauseBanner />
      </Providers>,
    );
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('No new tasks start');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ paused: false });
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    });
  });
});

describe('settings', () => {
  it('edits the workspace root under Advanced', async () => {
    const { api, calls } = testApi({
      'GET /organization': org(),
      'PATCH /organization': (init: RequestInit) =>
        org(JSON.parse(init.body as string) as Record<string, unknown>),
    });
    render(
      <Providers api={api}>
        <SettingsScreen />
      </Providers>,
    );
    const input = await screen.findByLabelText('Workspace root');
    await waitFor(() => {
      expect(input).toHaveValue('/home/u/agent-band/workspaces');
    });
    fireEvent.change(input, { target: { value: 'relative' } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Missing: Workspace root' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/data/ws' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ workspaceRoot: '/data/ws' });
    });
    await screen.findByText('Saved.');
  });
});
