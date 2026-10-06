import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { createMockDataSource } from './data/mock.ts';

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders the board by default', async () => {
    render(<App dataSource={createMockDataSource({ live: false, latencyMs: 0 })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: /^AB-31 / })).toBeInTheDocument();
  });
});
