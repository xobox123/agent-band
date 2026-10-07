import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useEscape } from './useEscape.ts';

export type DictationLang = 'pl-PL' | 'en-US';
export const DICTATION_LANGS: { code: DictationLang; label: string }[] = [
  { code: 'pl-PL', label: 'Polski' },
  { code: 'en-US', label: 'English' },
];
export const DICTATION_LANG_KEY = 'agent-band.dictation.lang';
const langListeners = new Set<(lang: DictationLang) => void>();

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative | undefined;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { readonly length: number; [index: number]: RecognitionResult | undefined };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isDictationSupported(): boolean {
  return typeof window !== 'undefined' && recognitionCtor() !== undefined;
}

export function loadDictationLang(): DictationLang {
  try {
    const v = localStorage.getItem(DICTATION_LANG_KEY);
    if (v === 'pl-PL' || v === 'en-US') return v;
  } catch {
    // storage unavailable
  }
  return 'pl-PL';
}

function storeDictationLang(lang: DictationLang) {
  try {
    localStorage.setItem(DICTATION_LANG_KEY, lang);
  } catch {
    // storage unavailable
  }
}

/** Joins a dictated chunk to existing text with sensible spaces around it. */
export function spliceDictation(
  value: string,
  start: number,
  end: number,
  chunk: string,
): { value: string; caret: number } {
  const text = chunk.trim();
  if (text === '') return { value, caret: end };
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before !== '' && !/\s$/.test(before) && !/^[.,;:!?)]/.test(text) ? ' ' : '';
  const trail = after !== '' && !/^\s/.test(after) && !/^[.,;:!?)]/.test(after) ? ' ' : '';
  const inserted = `${lead}${text}${trail}`;
  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + lead.length + text.length + (trail ? 1 : 0),
  };
}

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export type DictationError = 'denied' | 'network' | 'no-mic' | 'other' | null;

export const DICTATION_ERRORS: Record<Exclude<DictationError, null>, string> = {
  denied: 'Microphone access was denied. Allow it in your browser site settings and try again.',
  network: "Dictation lost its connection to your browser's speech service.",
  'no-mic': 'No microphone was found.',
  other: 'Dictation stopped unexpectedly.',
};

/** Dictates into a controlled textarea by committing text through a real input event. */
export function useDictation(ref: RefObject<HTMLTextAreaElement | null>) {
  const supported = isDictationSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<DictationError>(null);
  const [lang, setLangState] = useState<DictationLang>(loadDictationLang);
  const recRef = useRef<Recognition | null>(null);

  const commit = useCallback(
    (chunk: string) => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = spliceDictation(el.value, start, end, chunk);
      setNativeValue(el, next.value);
      el.setSelectionRange(next.caret, next.caret);
    },
    [ref],
  );

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(
    (language: DictationLang) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = language;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        if (recRef.current !== rec) return;
        let pending = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          const t = r?.[0]?.transcript ?? '';
          if (r?.isFinal) commit(t);
          else pending += t;
        }
        setInterim(pending.trim());
      };
      rec.onerror = (e) => {
        if (recRef.current !== rec) return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('denied');
        else if (e.error === 'network') setError('network');
        else if (e.error === 'audio-capture') setError('no-mic');
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setError('other');
        recRef.current = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
        setListening(false);
        setInterim('');
      };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        recRef.current = null;
        setListening(false);
        setInterim('');
      };
      setError(null);
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        recRef.current = null;
        setListening(false);
        setError('other');
      }
    },
    [commit],
  );

  const toggle = useCallback(() => {
    if (recRef.current) stop();
    else start(lang);
  }, [lang, start, stop]);

  const applyLang = useCallback(
    (next: DictationLang) => {
      setLangState(next);
      if (recRef.current) {
        const old = recRef.current;
        old.onresult = null;
        old.onerror = null;
        old.onend = null;
        old.abort();
        recRef.current = null;
        setInterim('');
        start(next);
      }
    },
    [start],
  );

  useEffect(() => {
    langListeners.add(applyLang);
    return () => {
      langListeners.delete(applyLang);
    };
  }, [applyLang]);

  const setLang = useCallback((next: DictationLang) => {
    storeDictationLang(next);
    for (const listener of langListeners) listener(next);
  }, []);

  useEscape(5, listening, stop);

  useEffect(
    () => () => {
      const rec = recRef.current;
      if (rec) {
        recRef.current = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      }
    },
    [],
  );

  return { supported, listening, interim, error, lang, setLang, toggle };
}
