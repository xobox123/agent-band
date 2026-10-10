import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { DictationTextarea } from './DictationButton.tsx';
import { DICTATION_LANG_KEY, spliceDictation } from '../hooks/useDictation.ts';

class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start = vi.fn();
  stop = vi.fn(() => {
    this.onend?.();
  });
  abort = vi.fn();
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] });
  }
}

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return (
    <DictationTextarea
      aria-label="Prompt"
      value={v}
      onChange={(e) => {
        setV(e.target.value);
      }}
    />
  );
}

const area = () => screen.getByLabelText<HTMLTextAreaElement>('Prompt');

describe('dictation', () => {
  beforeEach(() => {
    localStorage.clear();
    FakeRecognition.last = undefined;
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    vi.restoreAllMocks();
  });

  it('starts and stops from the button', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Dictate' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(FakeRecognition.last?.start).toHaveBeenCalled();
    expect(FakeRecognition.last?.lang).toBe('pl-PL');
    expect(FakeRecognition.last?.continuous).toBe(true);
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Listening/)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows interim text and commits final text at the caret', () => {
    render(<Harness initial="hello world" />);
    area().setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => {
      FakeRecognition.last?.say('brave', false);
    });
    expect(screen.getByText('brave')).toBeInTheDocument();
    expect(area().value).toBe('hello world');
    act(() => {
      FakeRecognition.last?.say(' brave', true);
    });
    expect(area().value).toBe('hello brave world');
    expect(area().selectionStart).toBe('hello brave'.length);
  });

  it('spaces chunks sensibly', () => {
    expect(spliceDictation('', 0, 0, ' hi ').value).toBe('hi');
    expect(spliceDictation('a', 1, 1, 'b').value).toBe('a b');
    expect(spliceDictation('a ', 2, 2, 'b').value).toBe('a b');
    expect(spliceDictation('a', 1, 1, '.').value).toBe('a.');
  });

  it('persists the language and uses it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictation language' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(localStorage.getItem(DICTATION_LANG_KEY)).toBe('en-US');
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(FakeRecognition.last?.lang).toBe('en-US');
  });

  it('shares language changes across two mounted fields and active sessions', () => {
    render(
      <>
        <div data-testid="first">
          <Harness />
        </div>
        <div data-testid="second">
          <Harness />
        </div>
      </>,
    );
    const first = within(screen.getByTestId('first'));
    const second = within(screen.getByTestId('second'));
    fireEvent.click(second.getByRole('button', { name: 'Dictate' }));
    const old = FakeRecognition.last;
    fireEvent.click(first.getByRole('button', { name: 'Dictation language' }));
    fireEvent.click(first.getByRole('menuitemradio', { name: 'English' }));
    expect(second.getByRole('button', { name: 'Dictation language' })).toHaveTextContent('EN');
    expect(old?.abort).toHaveBeenCalled();
    expect(FakeRecognition.last?.lang).toBe('en-US');
    fireEvent.click(second.getByRole('button', { name: 'Dictate' }));
    fireEvent.click(second.getByRole('button', { name: 'Dictate' }));
    expect(FakeRecognition.last?.lang).toBe('en-US');
  });

  it('restores a stored language', () => {
    localStorage.setItem(DICTATION_LANG_KEY, 'en-US');
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(FakeRecognition.last?.lang).toBe('en-US');
  });

  it('explains an unsupported browser', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    render(<Harness />);
    const btn = screen.getByRole('button', { name: 'Dictation is unavailable in this browser' });
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute('title', 'Dictation is unavailable in this browser');
  });

  it('reports denied permission and network errors', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => {
      FakeRecognition.last?.onerror?.({ error: 'not-allowed' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Microphone access was denied/);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => {
      FakeRecognition.last?.onerror?.({ error: 'network' });
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/speech service/);
  });

  it('toggles with Ctrl+Shift+M and stops on Escape', () => {
    render(<Harness />);
    fireEvent.keyDown(area(), { key: 'M', ctrlKey: true, shiftKey: true });
    expect(FakeRecognition.last?.start).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(area(), { key: 'm', metaKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'true');
  });
  it.each(['ctrlKey', 'metaKey'])(
    'toggles with %s+Shift+M while the microphone button is focused',
    (modifier) => {
      render(<Harness />);
      const btn = screen.getByRole('button', { name: 'Dictate' });
      btn.focus();
      fireEvent.click(btn);
      const rec = FakeRecognition.last;
      expect(btn).toHaveFocus();
      fireEvent.keyDown(btn, { key: 'M', [modifier]: true, shiftKey: true });
      expect(rec?.stop).toHaveBeenCalledOnce();
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      fireEvent.keyDown(btn, { key: 'M', [modifier]: true, shiftKey: true });
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    },
  );

  it('replaces selected text and keeps subsequent final chunks in order', () => {
    render(<Harness initial="hello old world" />);
    area().setSelectionRange(6, 9);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => {
      FakeRecognition.last?.say('new', true);
    });
    act(() => {
      FakeRecognition.last?.say('beautiful', true);
    });
    expect(area()).toHaveValue('hello new beautiful world');
    fireEvent.change(area(), { target: { value: `${area().value}!` } });
    expect(area()).toHaveValue('hello new beautiful world!');
  });

  it('uses the prefixed API and clears interim results on end', () => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(FakeRecognition.last?.interimResults).toBe(true);
    act(() => {
      FakeRecognition.last?.say('pending', false);
    });
    act(() => {
      FakeRecognition.last?.onend?.();
    });
    expect(screen.queryByText('pending')).toBeNull();
    expect(area()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Dictate' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('restarts in the new language and ignores results from the previous session', () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    const old = FakeRecognition.last;
    const lateResult = old?.onresult;
    fireEvent.click(screen.getByRole('button', { name: 'Dictation language' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    expect(old?.abort).toHaveBeenCalled();
    const current = FakeRecognition.last;
    expect(current?.lang).toBe('en-US');
    act(() => {
      lateResult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: 'stale' }], { isFinal: true })],
      });
    });
    expect(area()).toHaveValue('');
    unmount();
    expect(current?.abort).toHaveBeenCalled();
    expect(current?.onresult).toBeNull();
  });

  it('works when storage access throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Dictation language' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    expect(FakeRecognition.last?.lang).toBe('en-US');
  });
});
