import { StatusDot } from '../components/StatusDot.tsx';

interface Props {
  title: string;
  count: number | null;
  connection: 'connected' | 'reconnecting';
}

export function Header({ title, count, connection }: Props) {
  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      {count !== null ? (
        <span className="dim" aria-label={`${count} items`}>
          {count}
        </span>
      ) : null}
      <span className="header-spacer" />
      <span className="header-conn" aria-label="Connection state">
        <StatusDot kind="indicator" value={connection} />
      </span>
    </header>
  );
}
