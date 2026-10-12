import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ID, NOW, Providers, testApi } from '../../test-utils.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';

describe('Settings worker capacity', () => {
  const org = {
    id: ID(100),
    name: 'Organization',
    taskKeyPrefix: 'AB',
    timezone: 'UTC',
    policyId: null,
    paused: false,
    workspaceRoot: '/work',
    workerSlots: null,
    createdAt: NOW,
  };

  it('persists a numeric slot limit and clears it for automatic capacity', async () => {
    const { api, calls } = testApi({
      'GET /organization': org,
      'PATCH /organization': { ...org, workerSlots: 3 },
    });
    render(
      <Providers api={api}>
        <SettingsScreen />
      </Providers>,
    );
    const slots = await screen.findByRole('spinbutton', { name: 'Worker slots' });
    fireEvent.change(slots, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        workspaceRoot: '/work',
        workerSlots: 3,
      });
    });
  });

  it('validates the local limit before saving', async () => {
    const { api, calls } = testApi({ 'GET /organization': org });
    render(
      <Providers api={api}>
        <SettingsScreen />
      </Providers>,
    );
    const slots = await screen.findByRole('spinbutton', { name: 'Worker slots' });
    fireEvent.change(slots, { target: { value: '300' } });
    expect(screen.getByText(/Use an integer from 1 to 256/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });
});
