import type { ModelOption } from '@agent-band/contracts';
import { useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { Field } from '../../components/FormDialog.tsx';
import { useResource } from '../../hooks/useResource.ts';

interface Props {
  accountId: string;
  value: string;
  onChange: (model: string) => void;
}

const CUSTOM = '__custom__';

const optionText = (m: ModelOption) => (m.label === m.id ? m.id : `${m.label} (${m.id})`);

/** Model select filled from the chosen account's provider, with a free text escape hatch. */
export function ModelPicker({ accountId, value, onChange }: Props) {
  const api = useApi();
  const [custom, setCustom] = useState(false);
  const models = useResource(
    () => (accountId ? api.accounts.models(accountId) : Promise.resolve(null)),
    [accountId],
  );
  const items = models.data?.items ?? [];

  if (models.loading && accountId) {
    return (
      <Field label="Model" help="Loading models for this account...">
        <select className="field" disabled value="">
          <option value="">Loading...</option>
        </select>
      </Field>
    );
  }
  if (models.error || !accountId) {
    return (
      <Field
        label="Model"
        help={
          accountId
            ? 'Could not load the model list for this account. Enter a model id, or leave blank for the provider default.'
            : 'Blank uses the provider default.'
        }
      >
        <input
          className="field"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </Field>
    );
  }

  const known = items.some((m) => m.id === value);
  const showCustom = custom || (value !== '' && !known);
  const selected = showCustom ? CUSTOM : value;
  const help = models.data?.note ?? 'Provider default uses the account default.';
  return (
    <>
      <Field label="Model" help={help}>
        <select
          className="field"
          value={selected}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(next);
          }}
        >
          <option value="">Provider default</option>
          {items.map((m) => (
            <option key={m.id} value={m.id} title={m.description}>
              {optionText(m)}
            </option>
          ))}
          <option value={CUSTOM}>Custom...</option>
        </select>
      </Field>
      {showCustom ? (
        <Field label="Custom model id" help="Any model id the provider accepts.">
          <input
            className="field"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
        </Field>
      ) : null}
    </>
  );
}
