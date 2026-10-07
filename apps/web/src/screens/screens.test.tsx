import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ID, NOW, Providers, accountDto, agentDto, list, testApi } from '../test-utils.tsx';
import type { Routes } from '../test-utils.tsx';
import { AccountsScreen } from './accounts/AccountsScreen.tsx';
import { AgentsScreen } from './agents/AgentsScreen.tsx';
import { AuditScreen } from './audit/AuditScreen.tsx';
import { DashboardScreen } from './dashboard/DashboardScreen.tsx';
import { GroupsScreen } from './groups/GroupsScreen.tsx';
import { PeopleScreen } from './people/PeopleScreen.tsx';
import { PoliciesScreen } from './policies/PoliciesScreen.tsx';
import { SkillsScreen } from './skills/SkillsScreen.tsx';

function mount(routes: Routes, ui: ReactNode) {
  const { api, calls } = testApi(routes);
  render(<Providers api={api}>{ui}</Providers>);
  return calls;
}

const lastBody = (calls: { method: string; path: string; body: unknown }[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path).at(-1)?.body;

const POLICY_ID = ID(60);
const policyDetail = {
  id: POLICY_ID,
  name: 'Org baseline',
  description: 'Baseline',
  currentVersion: 2,
  createdBy: ID(200),
  createdAt: NOW,
  updatedAt: NOW,
  rules: { maxMode: 'edit', deniedTools: ['Bash(rm *)'] },
  versions: [
    { policyId: POLICY_ID, version: 1, rules: { maxMode: 'full-auto' }, createdBy: ID(200), createdAt: NOW },
    {
      policyId: POLICY_ID,
      version: 2,
      rules: { maxMode: 'edit', deniedTools: ['Bash(rm *)'] },
      createdBy: ID(200),
      createdAt: NOW,
    },
  ],
};
const policyRow = {
  id: policyDetail.id,
  name: policyDetail.name,
  description: policyDetail.description,
  currentVersion: policyDetail.currentVersion,
  createdBy: policyDetail.createdBy,
  createdAt: policyDetail.createdAt,
  updatedAt: policyDetail.updatedAt,
};

describe('Dashboard', () => {
  const routes: Routes = {
    'GET /dashboard': {
      cursor: 3,
      accounts: [
        {
          account: accountDto(),
          windows: [
            { window: '5h', usedPercent: 42, resetsAt: NOW },
            { window: 'weekly', usedPercent: 71, resetsAt: null },
          ],
          windowsUpdatedAt: new Date().toISOString(),
          reserveDetail: null,
          costToday: 0,
          costThisMonth: 0,
          availabilityReason: 'ok',
          tokensToday: 250_000,
          cachedTokensToday: 1_500_000,
          runningRuns: 1,
          blockedUntil: null,
        },
      ],
      agents: [{ agent: agentDto(), status: 'running', runningRunId: ID(40), tokensToday: 1234 }],
      runningRuns: [],
      queuedCount: 4,
      tokensToday: 250_000,
      cachedTokensToday: 1_500_000,
    },
    [`GET /agents/${ID(1)}`]: agentDto(),
    [`GET /agents/${ID(1)}/effective-policy`]: {
      rules: {},
      workDirSets: [],
      maxMode: 'edit',
      deniedTools: [],
      sources: [],
    },
    [`GET /agents/${ID(1)}/effective-skills`]: list([]),
    'GET /accounts': list([accountDto()]),
    'GET /agent-groups': list([]),
    'GET /policies': list([]),
    'GET /runs': list([]),
  };

  it('renders account cards with limit windows, tokens and agents with status', async () => {
    mount(routes, <DashboardScreen />);
    const card = await screen.findByRole('article', { name: 'Account Claude Max' });
    expect(within(card).getByRole('progressbar', { name: 'Claude Max 5h' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
    expect(within(card).getByRole('progressbar', { name: 'Claude Max weekly' })).toHaveAttribute(
      'aria-valuenow',
      '71',
    );
    expect(within(card).getByText('250,000 / 1,000,000')).toBeInTheDocument();
    expect(within(card).getByText('Not blocked')).toBeInTheDocument();
    const agents = screen.getByRole('table', { name: 'Agents' });
    expect(within(agents).getByText('Running')).toBeInTheDocument();
    expect(within(agents).getByText('1,234')).toBeInTheDocument();
  });

  it('shows identity, plan, reset times, the reserve marker and stale readings', async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString();
    const account = accountDto({
      limits: { maxConcurrentRuns: 2, stopAt: { fiveHourPercent: 70 } },
      connection: {
        loggedIn: true,
        plan: 'pro',
        email: 'ann@example.com',
        orgName: "Ann's Org",
        authMethod: 'claude.ai',
        checkedAt: new Date().toISOString(),
        usageDetails: null,
      },
    });
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const fresh = {
      ...(routes['GET /dashboard'] as { accounts: Record<string, unknown>[] }),
    };
    fresh.accounts = [
      {
        ...fresh.accounts[0],
        account,
        windowsUpdatedAt: stale,
        reserveDetail: 'reserve threshold reached (5h 72% >= 70%)',
        availabilityReason: 'reserve',
        windows: [{ window: '5h', usedPercent: 72, resetsAt: soon }],
      },
    ];
    mount({ ...routes, 'GET /dashboard': fresh }, <DashboardScreen />);
    const card = await screen.findByRole('article', { name: 'Account Claude Max' });
    expect(within(card).getByText('ann@example.com')).toBeInTheDocument();
    expect(within(card).getByText("Ann's Org")).toBeInTheDocument();
    expect(within(card).getByText('Claude Pro')).toBeInTheDocument();
    expect(within(card).getByText('Logged in')).toBeInTheDocument();
    expect(within(card).getByText('resets in 3h')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /stops new work at 70%/ })).toBeInTheDocument();
    expect(within(card).getByText('(stale)')).toBeInTheDocument();
    expect(within(card).getByText(/reserve threshold reached/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Refresh limits' })).toBeInTheDocument();
  });

  it('checks the login and refreshes limits from the card without a confirmation', async () => {
    const calls = mount(
      {
        ...routes,
        [`POST /accounts/${ID(10)}/probe`]: {
          loggedIn: true,
          identity: {},
          checkedAt: NOW,
          loginCommand: null,
        },
        [`POST /accounts/${ID(10)}/refresh-limits`]: {
          windows: [],
          updatedAt: null,
          error: null,
          details: null,
        },
      },
      <DashboardScreen />,
    );
    const card = await screen.findByRole('article', { name: 'Account Claude Max' });
    fireEvent.click(within(card).getByRole('button', { name: 'Check now' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path === `/accounts/${ID(10)}/probe`)).toBe(true);
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Refresh limits' }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/accounts/${ID(10)}/refresh-limits`)).toBe(true);
    });
  });

  it('shows cached tokens as a secondary line, not added to tokens today', async () => {
    mount(routes, <DashboardScreen />);
    const card = await screen.findByRole('article', { name: 'Account Claude Max' });
    expect(within(card).getByText('+ 1,500,000 cached')).toBeInTheDocument();
    expect(screen.getAllByText('+ 1,500,000 cached').length).toBe(2);
    expect(screen.getAllByText('250,000').length).toBeGreaterThan(0);
  });

  it('shows the agent hover card and opens details on click', async () => {
    mount(routes, <DashboardScreen />);
    const trigger = await screen.findByRole('button', { name: 'Open agent Ada' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('claude-opus');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Claude Max');
    fireEvent.click(trigger);
    expect(await screen.findByRole('complementary', { name: 'Ada details' })).toBeInTheDocument();
  });
});

describe('Agents screen', () => {
  const routes: Routes = {
    'GET /agents': list([agentDto({ groupIds: [ID(20)], policyId: POLICY_ID })]),
    'GET /accounts': list([accountDto()]),
    'GET /agent-groups': list([
      {
        id: ID(20),
        orgId: ID(100),
        name: 'Core',
        description: '',
        labels: [],
        policyId: null,
        agentIds: [ID(1)],
        createdBy: ID(200),
        createdAt: NOW,
      },
    ]),
    'GET /policies': list([policyRow]),
    'GET /runs': list([]),
    [`GET /policies/${POLICY_ID}`]: policyDetail,
    [`GET /agents/${ID(1)}/effective-policy`]: {
      rules: {
        maxMode: {
          value: 'edit',
          setBy: { level: 'org', policyId: POLICY_ID, version: 2 },
          contributors: [],
          coverage: 'cli-sandbox',
          coverageDetails: [],
        },
      },
      workDirSets: [['/work']],
      maxMode: 'edit',
      deniedTools: ['Bash(rm *)'],
      dailyTokenBudget: 5000,
      sources: [{ level: 'org', policyId: POLICY_ID, version: 2 }],
    },
    [`GET /agents/${ID(1)}/effective-skills`]: list([
      { skillId: ID(70), name: 'review', version: 3, contentHash: 'abcdef0123456789' },
    ]),
    'POST /agents': agentDto({ id: ID(2), slug: 'grace', name: 'Grace' }),
    [`PATCH /agents/${ID(1)}`]: agentDto({ enabled: false }),
  };

  it('lists agents and shows effective policy with the source level per rule and effective skills', async () => {
    mount(routes, <AgentsScreen />);
    const table = await screen.findByRole('table', { name: 'Agents' });
    expect(within(table).getByText('agent:ada')).toBeInTheDocument();
    expect(within(table).getByText('Core')).toBeInTheDocument();
    expect(within(table).getByText('Org baseline · v2')).toBeInTheDocument();
    fireEvent.click(within(table).getByText('agent:ada'));
    const details = await screen.findByRole('complementary', { name: 'Ada details' });
    expect(within(details).getByText('ada@agents.agent-band.local')).toBeInTheDocument();
    expect(within(details).getByText('Careful reviewer')).toBeInTheDocument();
    const policy = await within(details).findByRole('table', { name: 'Effective policy' });
    const maxMode = within(policy).getByText('maxMode').closest('tr') as HTMLElement;
    expect(maxMode).toHaveTextContent('edit');
    expect(maxMode).toHaveTextContent(`org: ${POLICY_ID} v2`);
    expect(maxMode).toHaveTextContent('cli-sandbox');
    const skills = await within(details).findByRole('table', { name: 'Effective skills' });
    expect(within(skills).getByText('review')).toBeInTheDocument();
  });

  it('creates an agent from the form', async () => {
    const calls = mount(routes, <AgentsScreen />);
    await screen.findByRole('table', { name: 'Agents' });
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Create agent' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }));
    expect(within(dialog).getByText('Name is required.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Grace' } });
    fireEvent.change(within(dialog).getByLabelText(/^Slug/), { target: { value: 'grace' } });
    fireEvent.change(within(dialog).getByLabelText(/^Labels/), { target: { value: 'qa, review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create agent' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/agents')).toMatchObject({
        slug: 'grace',
        name: 'Grace',
        accountId: ID(10),
        labels: ['qa', 'review'],
        role: 'worker',
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create agent' })).not.toBeInTheDocument();
    });
  });

  it('disables an agent from the details footer', async () => {
    const calls = mount(routes, <AgentsScreen />);
    fireEvent.click(await screen.findByText('agent:ada'));
    const details = await screen.findByRole('complementary', { name: 'Ada details' });
    fireEvent.click(within(details).getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      expect(lastBody(calls, 'PATCH', `/agents/${ID(1)}`)).toEqual({ enabled: false });
    });
  });

  it('shows the error state with Retry when loading fails', async () => {
    mount({}, <AgentsScreen />);
    expect(await screen.findByText('Could not load agents. Retry.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Agent groups screen', () => {
  const group = {
    id: ID(20),
    orgId: ID(100),
    name: 'Core',
    description: 'Core team',
    labels: ['x'],
    policyId: null,
    agentIds: [],
    createdBy: ID(200),
    createdAt: NOW,
  };
  const routes: Routes = {
    'GET /agent-groups': list([group]),
    'GET /agents': list([agentDto()]),
    'GET /policies': list([]),
    [`PUT /agent-groups/${ID(20)}/members/${ID(1)}`]: null,
    'POST /agent-groups': { ...group, id: ID(21), name: 'QA' },
  };

  it('renders the list and adds a member from details', async () => {
    const calls = mount(routes, <GroupsScreen />);
    fireEvent.click(await screen.findByText('Core team'));
    const details = await screen.findByRole('complementary', { name: 'Core details' });
    expect(within(details).getByText('This group has no agents.')).toBeInTheDocument();
    fireEvent.change(within(details).getByLabelText('Agent to add'), { target: { value: ID(1) } });
    fireEvent.click(within(details).getByRole('button', { name: 'Add member' }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === 'PUT' && c.path === `/agent-groups/${ID(20)}/members/${ID(1)}`),
      ).toBe(true);
    });
  });

  it('creates a group', async () => {
    const calls = mount(routes, <GroupsScreen />);
    await screen.findByRole('table', { name: 'Agent groups' });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    const dialog = screen.getByRole('dialog', { name: 'Create group' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'QA' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create group' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/agent-groups')).toMatchObject({ name: 'QA', labels: [] });
    });
  });
});

describe('Accounts screen', () => {
  const providers = {
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
      {
        id: 'openai',
        displayName: 'Codex CLI',
        harness: 'codex-cli',
        accountTypes: ['cli', 'api'],
        runnableTypes: ['cli'],
        accountFields: { type: 'object', properties: {} },
        secretField: null,
        adapterEnabled: true,
        capabilities: {
          runtimeToolEnforcement: false,
          limitWindows: ['5h', 'weekly'],
          costReporting: false,
          skills: true,
          systemPrompt: true,
        },
      },
      {
        id: 'openai_compatible',
        displayName: 'OpenAI-compatible endpoint',
        harness: 'codex-cli',
        accountTypes: ['api'],
        accountFields: {
          type: 'object',
          properties: {
            baseUrl: { type: 'string' },
            models: { type: 'array', items: { type: 'string' } },
            wireApi: { type: 'string', enum: ['chat', 'responses'] },
          },
          required: ['baseUrl'],
        },
        secretField: 'apiKey',
        adapterEnabled: false,
        runnableTypes: [],
        capabilities: {
          runtimeToolEnforcement: false,
          limitWindows: [],
          costReporting: false,
          skills: true,
          systemPrompt: true,
        },
      },
    ],
  };
  const routes: Routes = {
    'GET /accounts': list([accountDto({ hasSecret: true, secretUpdatedAt: NOW })]),
    'GET /providers': providers,
    'POST /accounts': accountDto({ id: ID(11) }),
  };

  it('shows hasSecret without ever exposing a secret', async () => {
    mount(routes, <AccountsScreen />);
    const table = await screen.findByRole('table', { name: 'Accounts' });
    expect(within(table).getByText('Stored')).toBeInTheDocument();
    fireEvent.click(within(table).getByText('Claude Max'));
    const details = await screen.findByRole('complementary', { name: 'Claude Max details' });
    expect(within(details).getByText(/^Stored \(updated/)).toBeInTheDocument();
  });

  it('builds the form from the provider schema and submits config and a write-only secret', async () => {
    const calls = mount(routes, <AccountsScreen />);
    await screen.findByRole('table', { name: 'Accounts' });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const dialog = screen.getByRole('dialog', { name: 'Create account' });
    expect(within(dialog).queryByLabelText(/^baseUrl/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Provider'), { target: { value: 'openai_compatible' } });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Local LLM' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(within(dialog).getByText('Fill in all required provider fields.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^baseUrl/), {
      target: { value: 'http://localhost:8000/v1' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^models/), { target: { value: 'a, b' } });
    const secret = within(dialog).getByLabelText(/^apiKey/);
    expect(secret).toHaveAttribute('type', 'password');
    fireEvent.change(secret, { target: { value: 'sk-test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/accounts')).toMatchObject({
        name: 'Local LLM',
        provider: 'openai_compatible',
        type: 'api',
        providerConfig: { baseUrl: 'http://localhost:8000/v1', models: ['a', 'b'] },
        secret: 'sk-test',
      });
    });
  });
});

describe('Accounts form connection methods', () => {
  const caps = {
    runtimeToolEnforcement: true,
    limitWindows: ['5h', 'weekly'],
    costReporting: true,
    skills: true,
    systemPrompt: true,
  };
  const providers = {
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
        capabilities: caps,
      },
      {
        id: 'openai',
        displayName: 'Codex CLI',
        harness: 'codex-cli',
        accountTypes: ['cli', 'api'],
        runnableTypes: ['cli'],
        accountFields: { type: 'object', properties: {} },
        secretField: null,
        adapterEnabled: true,
        capabilities: caps,
      },
    ],
  };
  const created = accountDto({
    id: ID(11),
    name: 'Side',
    configDir: '/home/x/.agent-band/accounts/claude-side',
  });
  const routes: Routes = {
    'GET /accounts': list([]),
    'GET /providers': providers,
    'GET /dashboard': {
      cursor: 1,
      accounts: [],
      agents: [],
      runningRuns: [],
      queuedCount: 0,
      tokensToday: 0,
      cachedTokensToday: 0,
    },
    'POST /accounts': created,
    [`POST /accounts/${ID(11)}/probe`]: { loggedIn: true, identity: {}, checkedAt: NOW, loginCommand: null },
    [`POST /accounts/${ID(11)}/login`]: {
      started: true,
      command: 'CLAUDE_CONFIG_DIR=/x claude auth login',
      authUrl: 'https://claude.ai/oauth/authorize?x=1',
    },
  };
  async function openForm(extra: Routes = {}) {
    const calls = mount({ ...routes, ...extra }, <AccountsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }));
    return { calls, dialog: screen.getByRole('dialog', { name: 'Create account' }) };
  }

  it('offers the three methods, hides the raw directory under Advanced and has no type select', async () => {
    const { dialog } = await openForm();
    expect(within(dialog).queryByLabelText('Type')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Use my current login/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Add another account/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /API key/ })).toBeEnabled();
    const dir = within(dialog).getByLabelText(/^Config directory/);
    expect(dir.closest('details')).not.toBeNull();
    expect(within(dialog).getByText(/Not a project folder/)).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText(/^API key/, { selector: 'input[type=password]' }),
    ).not.toBeInTheDocument();
  });

  it('disables the api method with "coming soon" when the adapter only runs cli', async () => {
    const { dialog } = await openForm();
    fireEvent.change(within(dialog).getByLabelText('Provider'), { target: { value: 'openai' } });
    expect(within(dialog).getByRole('radio', { name: /API key/ })).toBeDisabled();
    expect(within(dialog).getByText(/Coming soon for this provider/)).toBeInTheDocument();
  });

  it('checks the current login and shows email and plan', async () => {
    const { dialog } = await openForm({
      'POST /accounts/probe-config': {
        loggedIn: true,
        identity: { email: 'ann@example.com', plan: 'pro' },
        checkedAt: NOW,
        loginCommand: null,
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check login' }));
    expect(await within(dialog).findByText(/Logged in - ann@example.com - Claude Pro/)).toBeInTheDocument();
  });

  it('shows the exact login command when not logged in and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { dialog } = await openForm({
      'POST /accounts/probe-config': {
        loggedIn: false,
        identity: {},
        checkedAt: NOW,
        loginCommand: 'CLAUDE_CONFIG_DIR=~/.claude-side claude auth login',
      },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check login' }));
    expect(
      await within(dialog).findByText('CLAUDE_CONFIG_DIR=~/.claude-side claude auth login'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith('CLAUDE_CONFIG_DIR=~/.claude-side claude auth login');
  });

  it('creates a current-login account without a directory and checks it right away', async () => {
    const { calls, dialog } = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Mine' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      const body = lastBody(calls, 'POST', '/accounts') as Record<string, unknown>;
      expect(body).toMatchObject({ name: 'Mine', provider: 'claude', type: 'cli' });
      expect(body).not.toHaveProperty('configDir');
      expect(body).not.toHaveProperty('managedConfigDir');
    });
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/accounts/${ID(11)}/probe`)).toBe(true);
    });
  });

  it('adds another account with a managed directory, starts the login and shows the link and command', async () => {
    const { calls, dialog } = await openForm({
      'GET /accounts': list([created]),
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Add another account/ }));
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Side' } });
    expect(
      within(dialog).getByText(/CLAUDE_CONFIG_DIR=~\/\.claude-side claude auth login/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/accounts')).toMatchObject({ managedConfigDir: true, type: 'cli' });
    });
    await waitFor(() => {
      expect(calls.some((c) => c.path === `/accounts/${ID(11)}/login`)).toBe(true);
    });
    expect(await screen.findByText('Waiting for login in your browser...')).toBeInTheDocument();
    expect(screen.getByText('https://claude.ai/oauth/authorize?x=1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      'https://claude.ai/oauth/authorize?x=1',
    );
    expect(screen.getByText('CLAUDE_CONFIG_DIR=/x claude auth login')).toBeInTheDocument();
  });

  it('tests an API key before saving and sends it only in the create body', async () => {
    const { calls, dialog } = await openForm({
      'POST /accounts/probe-config': {
        loggedIn: true,
        identity: { plan: 'API key' },
        checkedAt: NOW,
        note: 'The key is verified on the first run.',
        loginCommand: null,
      },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: /API key/ }));
    expect(within(dialog).queryByLabelText(/^Config directory/)).not.toBeInTheDocument();
    expect(within(dialog).getByText('Daily cost budget (USD)')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Billing' } });
    const key = within(dialog).getByLabelText(/^API key/, { selector: 'input[type=password]' });
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: 'sk-ant-test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test key' }));
    expect(await within(dialog).findByText(/Logged in - API key/)).toBeInTheDocument();
    expect(lastBody(calls, 'POST', '/accounts/probe-config')).toMatchObject({
      type: 'api',
      secret: 'sk-ant-test',
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/accounts')).toMatchObject({
        type: 'api',
        secret: 'sk-ant-test',
        provider: 'claude',
      });
    });
  });

  it('sends the reserve thresholds and rejects out-of-range values', async () => {
    const { calls, dialog } = await openForm();
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Res' } });
    fireEvent.change(within(dialog).getByLabelText(/^Stop new work at \(5h %\)/), {
      target: { value: '150' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    expect(within(dialog).getByText('Stop thresholds must be between 1 and 100.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Stop new work at \(5h %\)/), {
      target: { value: '70' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Stop new work at \(weekly %\)/), {
      target: { value: '90' },
    });
    expect(within(dialog).getAllByText('Keeps a reserve for your own use.')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/accounts')).toMatchObject({
        limits: { stopAt: { fiveHourPercent: 70, weeklyPercent: 90 } },
      });
    });
  });
});

describe('Policies screen', () => {
  const routes: Routes = {
    'GET /policies': list([policyRow]),
    [`GET /policies/${POLICY_ID}`]: policyDetail,
    [`PATCH /policies/${POLICY_ID}`]: policyDetail,
  };

  it('lists versions and edits rules into a new version', async () => {
    const calls = mount(routes, <PoliciesScreen />);
    fireEvent.click(await screen.findByText('Org baseline'));
    const details = await screen.findByRole('complementary', { name: 'Org baseline details' });
    const versions = await within(details).findByRole('table', { name: 'Policy versions' });
    expect(within(versions).getByText('v2 (current)')).toBeInTheDocument();
    expect(within(versions).getByText('v1')).toBeInTheDocument();
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Org baseline' });
    fireEvent.change(within(dialog).getByLabelText(/^Max run minutes/), { target: { value: '30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new version' }));
    await waitFor(() => {
      expect(lastBody(calls, 'PATCH', `/policies/${POLICY_ID}`)).toEqual({
        name: 'Org baseline',
        description: 'Baseline',
        rules: { maxMode: 'edit', deniedTools: ['Bash(rm *)'], maxRunMinutes: 30 },
      });
    });
  });
});

describe('Skills screen', () => {
  const skill = {
    id: ID(70),
    name: 'review',
    description: 'Code review',
    currentVersion: 1,
    createdBy: ID(200),
    createdAt: NOW,
  };
  const routes: Routes = {
    'GET /skills': list([skill]),
    [`GET /skills/${ID(70)}`]: {
      ...skill,
      versions: [
        {
          skillId: ID(70),
          version: 1,
          contentHash: 'f'.repeat(64),
          sizeBytes: 2048,
          source: 'upload',
          origin: null,
          createdBy: ID(200),
          createdAt: NOW,
        },
      ],
    },
    'GET /skill-assignments': list([
      {
        id: ID(80),
        skillId: ID(70),
        pinnedVersion: null,
        scope: { org: true },
        createdBy: ID(200),
        createdAt: NOW,
      },
    ]),
    'GET /agents': list([agentDto()]),
    'GET /agent-groups': list([]),
    'POST /skills': skill,
    'POST /skill-assignments': {
      id: ID(81),
      skillId: ID(70),
      pinnedVersion: 1,
      scope: { agentId: ID(1) },
      createdBy: ID(200),
      createdAt: NOW,
    },
  };

  it('shows versions and assignments and assigns to an agent', async () => {
    const calls = mount(routes, <SkillsScreen />);
    fireEvent.click(await screen.findByText('Code review'));
    const details = await screen.findByRole('complementary', { name: 'review details' });
    expect(await within(details).findByRole('table', { name: 'Skill versions' })).toHaveTextContent('2.0 KB');
    expect(await within(details).findByText('Organization · always current')).toBeInTheDocument();
    fireEvent.change(within(details).getByLabelText('Assignment scope'), { target: { value: 'agent' } });
    fireEvent.change(within(details).getByLabelText('Assignment target'), { target: { value: ID(1) } });
    fireEvent.change(within(details).getByLabelText('Pinned version'), { target: { value: '1' } });
    fireEvent.click(within(details).getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/skill-assignments')).toEqual({
        skillId: ID(70),
        scope: { agentId: ID(1) },
        pinnedVersion: 1,
      });
    });
  });

  it('imports a zip as base64', async () => {
    const calls = mount(routes, <SkillsScreen />);
    await screen.findByRole('table', { name: 'Skills' });
    fireEvent.click(screen.getByRole('button', { name: 'Import skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Import skill' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(within(dialog).getByText('Choose a zip archive or the skill files.')).toBeInTheDocument();
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'skill.zip', { type: 'application/zip' });
    fireEvent.change(within(dialog).getByLabelText('Skill bundle'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/skills')).toEqual({ name: 'review', zip: btoa('PK\u0003\u0004') });
    });
  });
});

describe('Audit screen', () => {
  const event = (seq: number, action: string) => ({
    seq,
    orgId: ID(100),
    ts: NOW,
    actorId: ID(200),
    action,
    targetType: 'task',
    targetId: ID(30),
    data: { a: 1 },
    prevHash: 'p',
    hash: 'h',
  });
  it('filters, pages with a cursor, verifies and links the export', async () => {
    const calls = mount(
      {
        'GET /audit': (_init: RequestInit, url: URL) =>
          url.searchParams.get('cursor') === '2'
            ? { items: [event(1, 'task.created')], nextCursor: null, cursor: 9 }
            : { items: [event(3, 'run.start'), event(2, 'task.cancel')], nextCursor: 2, cursor: 9 },
        'GET /audit/verify': { ok: false, brokenAtSeq: 2, count: 3, fromSeq: 1, toSeq: 3 },
      },
      <AuditScreen />,
    );
    const table = await screen.findByRole('table', { name: 'Audit events' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(within(screen.getByRole('table', { name: 'Audit events' })).getAllByRole('row')).toHaveLength(4);
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Chain broken at seq 2');

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'run.start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(calls.filter((c) => c.path === '/audit').length).toBe(3);
    });
    expect(screen.getByRole('link', { name: 'Export JSONL' })).toHaveAttribute(
      'href',
      '/api/v1/audit/export?action=run.start',
    );
  });
});

describe('People and teams screen', () => {
  const user = {
    id: ID(200),
    handle: 'user:local',
    displayName: 'Local Owner',
    avatar: null,
    email: null,
    status: 'active',
  };
  const routes: Routes = {
    'GET /users': list([user]),
    'GET /teams': list([{ id: ID(90), name: 'Platform', description: '', memberIds: [] }]),
    'GET /role-bindings': list([
      { id: ID(91), subject: { userId: ID(200) }, role: 'owner', scope: { org: true }, createdAt: NOW },
    ]),
    'GET /agents': list([]),
    'GET /agent-groups': list([]),
    'POST /teams': { id: ID(92), name: 'Ops', description: '', memberIds: [] },
    'POST /role-bindings': {
      id: ID(93),
      subject: { teamId: ID(90) },
      role: 'operator',
      scope: { org: true },
      createdAt: NOW,
    },
  };

  it('renders users, creates a team and a role binding', async () => {
    const calls = mount(routes, <PeopleScreen />);
    const users = await screen.findByRole('table', { name: 'Users' });
    expect(within(users).getByText('user:local')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Role bindings' }));
    const bindings = await screen.findByRole('table', { name: 'Role bindings' });
    expect(within(bindings).getByText('User: Local Owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create role binding' }));
    const dialog = screen.getByRole('dialog', { name: 'Create role binding' });
    expect(within(dialog).getByRole('button', { name: 'Create binding' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Subject type'), { target: { value: 'team' } });
    fireEvent.change(within(dialog).getByLabelText('Subject'), { target: { value: ID(90) } });
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'operator' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create binding' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/role-bindings')).toEqual({
        subject: { teamId: ID(90) },
        role: 'operator',
        scope: { org: true },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Teams' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create team' }));
    const teamDialog = screen.getByRole('dialog', { name: 'Create team' });
    fireEvent.change(within(teamDialog).getByLabelText(/^Name/), { target: { value: 'Ops' } });
    fireEvent.click(within(teamDialog).getByRole('button', { name: 'Create team' }));
    await waitFor(() => {
      expect(lastBody(calls, 'POST', '/teams')).toEqual({ name: 'Ops', description: '' });
    });
  });
});
