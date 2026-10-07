import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError, fieldErrors } from '../api/client.ts';
import { Field, FormDialog } from './FormDialog.tsx';

function Demo({ serverError }: { serverError?: unknown }) {
  const [name, setName] = useState('');
  const [agent, setAgent] = useState('');
  const errors: Record<string, string> = {};
  if (name.trim() === '') errors['name'] = 'Name is required.';
  if (agent === '') errors['agent'] = 'Select an agent.';
  return (
    <FormDialog
      title="Demo"
      submitLabel="Save"
      pending={false}
      error={serverError}
      errors={errors}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    >
      <Field label="Name" name="name" required>
        <input
          className="field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </Field>
      <Field label="Agent" name="agent" required>
        <select
          className="field"
          value={agent}
          onChange={(e) => {
            setAgent(e.target.value);
          }}
        >
          <option value="">Select</option>
          <option value="a">A</option>
        </select>
      </Field>
    </FormDialog>
  );
}

describe('form validation', () => {
  it('marks required fields and lists what is missing next to the submit button', () => {
    render(<Demo />);
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    const hint = screen.getByRole('button', { name: 'Missing: Name, Agent' });
    expect(screen.getByLabelText(/^Name/)).not.toHaveAttribute('aria-invalid');
    fireEvent.click(hint);
    expect(screen.getByLabelText(/^Name/)).toHaveFocus();
  });

  it('highlights a field after blur and clears it live while typing', () => {
    render(<Demo />);
    const input = screen.getByLabelText(/^Name/);
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('is-invalid');
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.queryByText('Select an agent.')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'x' } });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('button', { name: 'Missing: Agent' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Agent/), { target: { value: 'a' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByText(/Missing:/)).not.toBeInTheDocument();
  });

  it('shows all errors and focuses the first invalid field on Enter submit', async () => {
    render(<Demo />);
    fireEvent.submit(screen.getByLabelText(/^Name/).closest('form') as HTMLFormElement);
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Select an agent.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/^Name/)).toHaveFocus();
    });
  });

  it('maps server validation details to fields', () => {
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'Request validation failed',
      details: [
        { path: ['name'], message: 'already taken' },
        { instancePath: '/agent', message: 'unknown agent' },
      ],
    });
    expect(fieldErrors(error)).toEqual({ name: 'already taken', agent: 'unknown agent' });
    expect(fieldErrors(error, (p) => `x.${p}`)).toEqual({
      'x.name': 'already taken',
      'x.agent': 'unknown agent',
    });
    render(<Demo serverError={error} />);
    expect(screen.getByText('already taken')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Agent/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('submitting an incomplete form', () => {
  it('reveals every error on click instead of silently doing nothing', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Agent/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Select an agent.')).toBeInTheDocument();
  });
});

describe('server errors without details', () => {
  it('maps a known error code to its field', () => {
    const error = new ApiError({
      status: 422,
      code: 'work_dir_outside_policy',
      message: 'Folder /x is outside the allowed directories.',
    });
    expect(fieldErrors(error)).toEqual({ workDir: 'Folder /x is outside the allowed directories.' });
    expect(fieldErrors(error, undefined, { work_dir_outside_policy: 'folder' })).toEqual({
      folder: 'Folder /x is outside the allowed directories.',
    });
  });

  it('shows messages for fields the form does not have at the bottom', () => {
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'Request validation failed',
      details: [{ path: ['nowhere'], message: 'bad value' }],
    });
    render(<Demo serverError={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent('nowhere: bad value');
  });

  it('clears a server field error once that field is edited', () => {
    const error = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'x',
      details: [{ path: ['name'], message: 'already taken' }],
    });
    render(<Demo serverError={error} />);
    expect(screen.getByText('already taken')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'z' } });
    expect(screen.queryByText('already taken')).not.toBeInTheDocument();
  });
});
