import type { ProviderDiagnostics } from '@agent-band/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';

const LABELS: [keyof ProviderDiagnostics, string][] = [
  ['claude', 'Claude'],
  ['openai', 'Codex'],
  ['gemini', 'Gemini'],
];

/** Where the server found each provider CLI, with a button to look again. */
export function CliDiagnostics() {
  const api = useApi();
  const [data, setData] = useState<ProviderDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    (fresh: boolean) => {
      setBusy(true);
      (fresh ? api.redetectProviders() : api.providerDiagnostics())
        .then(setData, () => undefined)
        .finally(() => {
          setBusy(false);
        });
    },
    [api],
  );
  useEffect(() => {
    load(false);
  }, [load]);
  if (!data) return null;
  return (
    <div className="cli-diagnostics" aria-label="Detected CLIs">
      {LABELS.map(([id, label]) => {
        const d = data[id];
        return (
          <div key={id}>
            {label} CLI:{' '}
            {d.binary ? `${d.binary}${d.version ? ` (${d.version})` : ''}` : (d.error ?? 'not found')}
          </div>
        );
      })}
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => {
          load(true);
        }}
      >
        Re-detect
      </button>
    </div>
  );
}
