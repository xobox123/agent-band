import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ID, Providers, testApi } from '../../test-utils.tsx';
import type { Routes } from '../../test-utils.tsx';
import { ModelPicker } from './ModelPicker.tsx';

const A = ID(10);
const B = ID(11);
const stamp = '2026-10-07T09:00:00.000Z';
const modelList = (items: { id: string; label: string; isDefault?: boolean }[]) => ({
  items: items.map((m) => ({ isDefault: false, source: 'native', ...m })),
  fetchedAt: stamp,
});

function Harness() {
  const [account, setAccount] = useState(A);
  const [model, setModel] = useState('');
  return (
    <div>
      <button
        onClick={() => {
          setAccount(B);
        }}
      >
        switch
      </button>
      <output aria-label="value">{model}</output>
      <ModelPicker accountId={account} value={model} onChange={setModel} />
    </div>
  );
}

function mount(routes: Routes) {
  const { api, calls } = testApi(routes);
  render(
    <Providers api={api}>
      <Harness />
    </Providers>,
  );
  return calls;
}

describe('ModelPicker', () => {
  const routes: Routes = {
    [`GET /accounts/${A}/models`]: modelList([
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', isDefault: true },
      { id: 'gpt-6-luna', label: 'GPT-6-Luna' },
    ]),
    [`GET /accounts/${B}/models`]: modelList([{ id: 'sonnet', label: 'Sonnet' }]),
  };

  it('loads models, shows label and id, and picks one', async () => {
    mount(routes);
    const select = await screen.findByRole('combobox');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual([
      'Provider default',
      'GPT-6.1-Sol (gpt-6.1-sol)',
      'GPT-6-Luna (gpt-6-luna)',
      'Custom...',
    ]);
    fireEvent.change(select, { target: { value: 'gpt-6-luna' } });
    expect(screen.getByLabelText('value')).toHaveTextContent('gpt-6-luna');
  });

  it('reloads when the account changes', async () => {
    const calls = mount(routes);
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => {
      expect(within(screen.getByRole('combobox')).getByText('Sonnet (sonnet)')).toBeInTheDocument();
    });
    expect(calls.filter((c) => c.path.endsWith('/models')).map((c) => c.path)).toEqual([
      `/accounts/${A}/models`,
      `/accounts/${B}/models`,
    ]);
  });

  it('accepts a custom model id', async () => {
    mount(routes);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: '__custom__' } });
    fireEvent.change(screen.getByLabelText(/^Custom model id/), { target: { value: 'my-model' } });
    expect(screen.getByLabelText('value')).toHaveTextContent('my-model');
    expect(screen.getByRole('combobox')).toHaveValue('__custom__');
  });

  it('falls back to free text with a note when loading fails', async () => {
    mount({});
    expect(await screen.findByText(/Could not load the model list/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'free-text' } });
    expect(screen.getByLabelText('value')).toHaveTextContent('free-text');
  });
});
