import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, TextareaHTMLAttributes } from 'react';
import { DICTATION_ERRORS, DICTATION_LANGS, useDictation } from '../hooks/useDictation.ts';

const PRIVACY = "Uses your browser's speech service";
const UNSUPPORTED = 'Dictation is unavailable in this browser';

function MicIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

type Dictation = ReturnType<typeof useDictation>;

/** Mic toggle with a small language menu; drive it with the object returned by useDictation. */
export function DictationButton({ dictation }: { dictation: Dictation }) {
  const { supported, listening, lang, setLang, toggle } = dictation;
  const [open, setOpen] = useState(false);
  const menuId = useId();
  if (!supported) {
    return (
      <span className="dictation-controls" title={UNSUPPORTED}>
        <button
          type="button"
          className="dictation-btn"
          disabled
          aria-pressed={false}
          aria-label={UNSUPPORTED}
        >
          <MicIcon />
        </button>
      </span>
    );
  }
  return (
    <span className="dictation-controls">
      <button
        type="button"
        className={`dictation-btn${listening ? ' is-listening' : ''}`}
        aria-pressed={listening}
        aria-label="Dictate"
        title={`${listening ? 'Stop dictation' : 'Start dictation'} (Ctrl/Cmd+Shift+M). ${PRIVACY}`}
        onClick={toggle}
      >
        <MicIcon />
      </button>
      <button
        type="button"
        className="dictation-btn dictation-lang"
        aria-label="Dictation language"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {lang.slice(0, 2).toUpperCase()}
      </button>
      {open ? (
        <div className="dictation-menu" id={menuId} role="menu">
          {DICTATION_LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === l.code}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** Drop-in textarea with dictation; forwards every textarea prop (Field injects aria props). */
export function DictationTextarea({ onKeyDown, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(ref);
  const onKey = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (
      !e.defaultPrevented &&
      !e.repeat &&
      !rest.disabled &&
      !rest.readOnly &&
      e.shiftKey &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === 'm'
    ) {
      e.preventDefault();
      if (dictation.supported) dictation.toggle();
    }
  };
  return (
    <span className="dictation" onKeyDown={onKey}>
      <textarea {...rest} ref={ref} onKeyDown={onKeyDown} />
      {!rest.disabled && !rest.readOnly ? <DictationButton dictation={dictation} /> : null}
      <span className="dictation-status" aria-live="polite">
        {dictation.listening ? (
          <>
            <span className="dictation-dot" aria-hidden="true" />
            {'Listening… '}
            <span className="dictation-interim">{dictation.interim}</span>
          </>
        ) : null}
      </span>
      {dictation.error ? (
        <span className="field-error" role="alert">
          {DICTATION_ERRORS[dictation.error]}
        </span>
      ) : null}
    </span>
  );
}
