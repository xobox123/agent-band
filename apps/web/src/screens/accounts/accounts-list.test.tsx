import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { duplicateIdentities } from '../../lib/account.ts';
import { ID, NOW, Providers, accountDto, list, testApi } from '../../test-utils.tsx';
import type { Routes } from '../../test-utils.tsx';
import { AccountsScreen } from './AccountsScreen.tsx';

const connection = (email: string, orgName: string | null = 'Acme') => ({
  loggedIn: true,
  plan: 'max',
  email,
  orgName,
  authMethod: null,
  checkedAt: NOW,
  usageDetails: null,
});

const dash = (account: ReturnType<typeof accountDto>, over: Record<string, unknown> = {}) => ({
  account,
  windows: [
    { window: '5h', usedPercent: 42, resetsAt: NOW },
    { window: 'weekly', usedPercent: 91, resetsAt: null },
  ],
  windowsUpdatedAt: new Date().toISOString(),
  reserveDetail: null,
  costToday: 1.5,
  costThisMonth: 3,
  availabilityReason: 'ok',
  tokensToday: 0,
  cachedTokensToday: 0,
  runningRuns: 0,
  blockedUntil: null,
  ...over,
});

const a = accountDto({
  id: ID(10),
  name: 'Main',
  connection: connection('Dev@Example.com'),
  limits: { maxConcurrentRuns: 1, stopAt: { fiveHourPercent: 80 } },
});
const b = accountDto({ id: ID(11), name: 'Spare', connection: connection('dev@example.com') });
const c = accountDto({
  id: ID(12),
  name: 'Other',
  connection: connection('someone@else.com'),
});
const api = accountDto({
  id: ID(13),
  name: 'Keyed',
  type: 'api',
  hasSecret: true,
  limits: { maxConcurrentRuns: 1, dailyCostBudgetUsd: 10 },
});

const routes: Routes = {
  'GET /accounts': list([a, b, c, api]),
  'GET /providers': {
    items: [
      {
        id: 'claude',
        displayName: 'Claude Code',
        harness: 'claude-cli',
        accountTypes: ['cli', 'api'],
        runnableTypes: ['cli', 'api'],
        accountFields: { type: 'object', properties: {} },
        secretField: null,
        adapterEnabled: true,
        capabilities: {
          runtimeToolEnforcement: true,
          limitWindows: ['5h', 'weekly'],
          costReporting: true,
          skills: true,
          systemPrompt: true,
        },
      },
    ],
  },
  'GET /dashboard': {
    cursor: 1,
    accounts: [dash(a), dash(b), dash(c), dash(api)],
    agents: [],
    runningRuns: [],
    queuedCount: 0,
    tokensToday: 0,
    cachedTokensToday: 0,
  },
};

function open() {
  const { api: client } = testApi(routes);
  render(
    <Providers api={client}>
      <AccountsScreen />
    </Providers>,
  );
}

describe('Accounts list', () => {
  it('shows compact limit bars after the login column and spend for API accounts', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Accounts' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.indexOf('Limits')).toBe(headers.indexOf('Login') + 1);
    expect(headers).not.toContain('Secret');

    const main = within(table).getByRole('row', { name: /^Main / });
    expect(within(main).getByRole('progressbar', { name: 'Main 5h' })).toHaveAttribute('aria-valuenow', '42');
    expect(within(main).getByRole('progressbar', { name: 'Main weekly' })).toHaveAttribute(
      'aria-valuenow',
      '91',
    );
    expect(within(main).getByRole('img', { name: /stops new work at 80%/ })).toBeInTheDocument();

    const keyed = within(table).getByRole('row', { name: /^Keyed / });
    expect(within(keyed).getByText('$1.5 / $10')).toBeInTheDocument();
    expect(within(keyed).getByText('API key set')).toBeInTheDocument();
    expect(within(main).queryByText('API key set')).not.toBeInTheDocument();
  });

  it('warns about accounts sharing one login and explains it in the details panel', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Accounts' });
    const main = within(table).getByRole('row', { name: /^Main / });
    const warning = within(main).getByRole('img', { name: 'Same login as Spare' });
    expect(warning).toHaveAttribute(
      'title',
      'Same login as Spare: both use one subscription and share limits',
    );
    expect(
      within(within(table).getByRole('row', { name: /^Other / })).queryByRole('img', { name: /Same login/ }),
    ).toBeNull();
    fireEvent.click(within(main).getByText('Main'));
    const panel = await screen.findByRole('complementary', { name: 'Main details' });
    expect(within(panel).getByText(/Same login as Spare/)).toBeInTheDocument();
    expect(within(panel).getByText(/Add another account/)).toBeInTheDocument();
  });

  it('finds duplicates by provider identity and ignores unknown logins', () => {
    const x = accountDto({ id: ID(1), name: 'X', providerIdentity: 'org-1' });
    const y = accountDto({ id: ID(2), name: 'Y', providerIdentity: 'ORG-1' });
    const z = accountDto({ id: ID(3), name: 'Z' });
    expect(duplicateIdentities([x, y, z])).toEqual(
      new Map([
        [ID(1), ['Y']],
        [ID(2), ['X']],
      ]),
    );
  });
});
