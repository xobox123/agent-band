import { EmptyState } from '../components/EmptyState.tsx';

export function Placeholder({ name }: { name: string }) {
  return <EmptyState title={name} description={`The ${name} screen is not implemented yet.`} />;
}
