import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DetailsPanel } from './DetailsPanel.tsx';
import { Dock } from './Dock.tsx';
import { Field, FormDialog } from './FormDialog.tsx';
import { StartDialog } from './StartDialog.tsx';

function Form({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <FormDialog
      title="Demo form"
      submitLabel="Save"
      pending={false}
      onSubmit={() => undefined}
      onCancel={onCancel}
    >
      <Field label="Name" name="name">
        <input
          className="field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}

describe('close button', () => {
  it('closes a pristine form directly', () => {
    const onCancel = vi.fn();
    render(<Form onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding edits, via the button, Escape and the backdrop', () => {
    const onCancel = vi.fn();
    render(<Form onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click and on Escape', () => {
    const onCancel = vi.fn();
    const { container } = render(<Form onCancel={onCancel} />);
    fireEvent.mouseDown(container.querySelector('.overlay') as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('is present on the confirm dialog, start dialog, details panel and dock', () => {
    const close = vi.fn();
    const { unmount } = render(
      <ConfirmDialog title="Sure?" message="m" confirmLabel="Yes" onConfirm={close} onCancel={close} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
    unmount();

    const start = render(
      <StartDialog title="Start" subject="a task" onConfirm={() => Promise.resolve()} onCancel={close} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(2);
    start.unmount();

    const panel = render(
      <DetailsPanel title="T" onClose={close}>
        body
      </DetailsPanel>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(3);
    panel.unmount();

    render(
      <Dock title="Logs" onClose={close}>
        body
      </Dock>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(4);
  });
});
