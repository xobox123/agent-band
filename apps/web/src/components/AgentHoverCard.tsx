import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AvatarSpec } from '../data/types.ts';
import { Avatar } from './Avatar.tsx';
import { StatusDot } from './StatusDot.tsx';

export interface AgentHoverInfo {
  id: string;
  name: string;
  handle: string;
  avatar: AvatarSpec | string | null;
  model: string | null;
  role: string;
  /** running, idle, blocked or disabled. */
  status: string;
  provider?: string | undefined;
  accountName?: string | undefined;
  runningRunId?: string | null | undefined;
}

interface Props {
  agent: AgentHoverInfo;
  /** Opens the agent details panel. */
  onOpen: (agentId: string) => void;
  /** Visible content next to the avatar, default is the agent name. */
  children?: ReactNode;
  size?: number;
}

const ROLE: Record<string, string> = { leader: 'Leader', worker: 'Worker', reviewer: 'Reviewer' };

export function AgentHoverCard({ agent, onOpen, children, size = 22 }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const show = () => {
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
  };
  return (
    <span
      className="hovercard"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          hide();
        }
      }}
    >
      <button
        type="button"
        className="hovercard-trigger"
        aria-describedby={open ? id : undefined}
        aria-label={`Open agent ${agent.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(agent.id);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
      >
        <Avatar name={agent.name} avatar={agent.avatar} size={size} />
        {children === undefined ? <span>{agent.name}</span> : children}
      </button>
      {open ? (
        <span className="hovercard-pop" role="tooltip" id={id}>
          <strong>{agent.name}</strong>
          <span className="mono dim">{agent.handle}</span>
          <dl className="kv kv-compact">
            <dt>Model</dt>
            <dd>{agent.model ?? 'Provider default'}</dd>
            <dt>Account</dt>
            <dd>{[agent.provider, agent.accountName].filter(Boolean).join(' · ') || 'Unknown account'}</dd>
            <dt>Role</dt>
            <dd>{ROLE[agent.role] ?? agent.role}</dd>
            <dt>Status</dt>
            <dd>
              <StatusDot kind="agent" value={agent.status} />
            </dd>
            <dt>Current run</dt>
            <dd className="mono">{agent.runningRunId ? agent.runningRunId.slice(0, 8) : 'None'}</dd>
          </dl>
        </span>
      ) : null}
    </span>
  );
}
