import { StatusDot } from '../components/StatusDot.tsx';
import { useApi } from '../api/context.tsx';
import { useResource } from '../hooks/useResource.ts';
import { PauseButton } from './PauseBanner.tsx';

interface Props {
  title: string;
  count: number | null;
  connection: 'connecting' | 'connected' | 'reconnecting';
}

export function Header({ title, count, connection }: Props) {
  const api = useApi();
  const capacity = useResource(() => api.workerCapacity(), [], ['run.', 'account.', 'org.']);
  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      {count !== null ? (
        <span className="dim" aria-label={`${count} items`}>
          {count}
        </span>
      ) : null}
      <span className="header-spacer" />
      {capacity.data ? (
        <span className="dim" role="status" aria-label="Worker capacity">
          {`Running ${capacity.data.activeRuns}/${capacity.data.slots} slots`}
        </span>
      ) : null}
      <PauseButton />
      <span className="header-conn" aria-label="Connection state">
        <StatusDot kind="indicator" value={connection} />
      </span>
    </header>
  );
}
