import { Badge } from '../../components/Badge.tsx';
import type { AgentDto } from '@agent-band/contracts';
import type { ReactNode } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useApi } from '../../api/context.tsx';
import { Avatar } from '../../components/Avatar.tsx';
import { DetailsPanel } from '../../components/DetailsPanel.tsx';
import { ErrorState } from '../../components/ErrorState.tsx';
import { Resource } from '../../components/Resource.tsx';
import { StatusDot } from '../../components/StatusDot.tsx';
import { useResource } from '../../hooks/useResource.ts';
import { copyText, formatTime, shortId } from '../../lib/format.ts';

interface Props {
  agentId: string;
  /** Known agent; when omitted it is fetched. */
  agent?: AgentDto | undefined;
  onClose: () => void;
  footer?: ReactNode;
  onOpenRun?: ((runId: string) => void) | undefined;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function AgentDetails({ agentId, agent: known, onClose, footer, onOpenRun }: Props) {
  const api = useApi();
  const fetched = useResource(
    () => (known ? Promise.resolve(known) : api.agents.get(agentId)),
    [agentId, known?.updatedAt],
    ['agent'],
  );
  const agent = known ?? fetched.data;

  if (!agent) {
    return (
      <DetailsPanel title="Agent" subtitle={shortId(agentId)} onClose={onClose}>
        {fetched.error ? (
          <ErrorState
            message={`Could not load this agent. ${errorMessage(fetched.error)}`}
            onRetry={fetched.reload}
          />
        ) : (
          <p className="dim">Loading agent</p>
        )}
      </DetailsPanel>
    );
  }
  return <Loaded agent={agent} onClose={onClose} footer={footer} onOpenRun={onOpenRun} />;
}

function Loaded({
  agent,
  onClose,
  footer,
  onOpenRun,
}: {
  agent: AgentDto;
  onClose: () => void;
  footer?: ReactNode;
  onOpenRun?: ((runId: string) => void) | undefined;
}) {
  const api = useApi();
  const refs = useResource(async () => {
    const [accounts, groups, policies] = await Promise.all([
      api.accounts.list(),
      api.groups.list(),
      api.policies.list(),
    ]);
    return { accounts: accounts.items, groups: groups.items, policies: policies.items };
  }, [agent.id]);
  const policy = useResource(
    async () => {
      const effective = await api.agents.effectivePolicy(agent.id);
      return effective;
    },
    [agent.id, agent.updatedAt, agent.groupIds.join(',')],
    ['policy.', 'agent', 'org.'],
  );
  const skills = useResource(
    () => api.agents.effectiveSkills(agent.id),
    [agent.id, agent.groupIds.join(',')],
    ['skill.', 'agent'],
  );
  const runs = useResource(() => api.runs.list({ agentId: agent.id }), [agent.id], ['run.updated']);

  const account = refs.data?.accounts.find((a) => a.id === agent.accountId);
  const groupName = (id: string) =>
    refs.data?.groups.find((g) => g.id === id)?.name ?? `Deleted group ${shortId(id)}`;
  const policyName = agent.policyId
    ? (refs.data?.policies.find((p) => p.id === agent.policyId)?.name ??
      `Deleted policy ${shortId(agent.policyId)}`)
    : 'No agent restriction';

  return (
    <DetailsPanel title={agent.name} subtitle={agent.handle} onClose={onClose} footer={footer}>
      <div className="panel-row">
        <Avatar name={agent.name} avatar={agent.avatar} size={36} />
        <StatusDot kind="agent" value={agent.enabled ? 'enabled' : 'disabled'} />
        {agent.paused ? <Badge tone="warn">Paused</Badge> : null}
      </div>
      <h3 className="section-title">Persona and identity</h3>
      <dl className="kv">
        <Row label="Persona">
          {agent.persona ? <span className="log-text">{agent.persona}</span> : 'No persona'}
        </Row>
        <Row label="Slug">{agent.slug}</Row>
        <Row label="Role">{agent.role}</Row>
        <Row label="ID">
          <span className="mono">{agent.id}</span>{' '}
          <button
            type="button"
            className="btn"
            onClick={() => {
              copyText(agent.id);
            }}
          >
            Copy
          </button>
        </Row>
        <Row label="Created">{formatTime(agent.createdAt)}</Row>
      </dl>
      <h3 className="section-title">Git identity</h3>
      <dl className="kv">
        <Row label="Name">{agent.gitIdentity.name}</Row>
        <Row label="Email">{agent.gitIdentity.email}</Row>
      </dl>
      <h3 className="section-title">Configuration</h3>
      <dl className="kv">
        <Row label="Account">{account ? `${account.name} (${account.provider})` : agent.accountId}</Row>
        <Row label="Model">{agent.model ?? 'Provider default'}</Row>
        <Row label="Agent policy">{policyName}</Row>
        <Row label="Labels">
          {agent.labels.length === 0 ? (
            'No labels'
          ) : (
            <ul className="chips">
              {agent.labels.map((l) => (
                <li key={l} className="chip">
                  {l}
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="System prompt">
          {agent.systemPrompt ? (
            <details>
              <summary>Show</summary>
              <pre className="prompt">{agent.systemPrompt}</pre>
            </details>
          ) : (
            'None'
          )}
        </Row>
      </dl>
      <h3 className="section-title">Groups</h3>
      {agent.groupIds.length === 0 ? (
        <p className="dim">No groups</p>
      ) : (
        <ul className="chips">
          {agent.groupIds.map((id) => (
            <li key={id} className="chip">
              {groupName(id)}
            </li>
          ))}
        </ul>
      )}
      <h3 className="section-title">Effective policy</h3>
      <Resource state={policy} errorMessage="Could not calculate effective configuration. Retry.">
        {(effective) => (
          <table className="table-plain" aria-label="Effective policy">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Effective value</th>
                <th>Set by</th>
                <th>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(effective.rules).map(([name, rule]) => (
                <tr key={name}>
                  <td className="mono">{name}</td>
                  <td>{JSON.stringify(rule.value)}</td>
                  <td>
                    {rule.setBy
                      ? `${rule.setBy.level}: ${rule.setBy.policyId} v${String(rule.setBy.version)}`
                      : 'Default'}
                  </td>
                  <td title={rule.coverageDetails.map((d) => `${d.mechanism}: ${d.scope}`).join('\n')}>
                    {rule.coverage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Resource>
      <h3 className="section-title">Effective skills</h3>
      <Resource state={skills} errorMessage="Could not load effective skills. Retry.">
        {(page) =>
          page.items.length === 0 ? (
            <p className="dim">No effective skills</p>
          ) : (
            <table className="table-plain" aria-label="Effective skills">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Version</th>
                  <th>Hash</th>
                  <th>Origin</th>
                  <th>Pin</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((s) => (
                  <tr key={s.skillId}>
                    <td>{s.name}</td>
                    <td>{`v${String(s.version)}`}</td>
                    <td>{JSON.stringify(s.origin)}</td>
                    <td>{s.pinnedVersion === null ? 'Latest' : s.pinnedVersion}</td>
                    <td className="mono" title={s.contentHash}>
                      {s.contentHash.slice(0, 12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Resource>
      <h3 className="section-title">Recent runs</h3>
      <Resource state={runs} errorMessage="Could not load runs. Retry.">
        {(page) =>
          page.items.length === 0 ? (
            <p className="dim">No runs yet</p>
          ) : (
            <ul className="plain-list">
              {[...page.items]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .slice(0, 10)
                .map((r) => (
                  <li key={r.id}>
                    <StatusDot kind="run" value={r.status} /> <span className="mono">{shortId(r.id)}</span>{' '}
                    {formatTime(r.startedAt)}{' '}
                    {onOpenRun ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          onOpenRun(r.id);
                        }}
                      >
                        Open logs
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          )
        }
      </Resource>
    </DetailsPanel>
  );
}
