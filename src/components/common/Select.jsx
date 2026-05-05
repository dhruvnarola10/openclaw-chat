// Custom dropdown that replaces the native <select>. Native selects
// can't be styled (option list width, font, hover etc. are OS-controlled),
// which is why long model names like "gemini-2.5-flash-native-audio-preview"
// get clipped on the closed control AND in the open menu. This component:
//   • renders the trigger with a flex-shrink label so the chevron stays put
//   • opens a fully-styled menu that matches our palette
//   • menu width = trigger width but `min-width` lets it grow as needed
//   • respects keyboard (↑/↓/Enter/Esc), click-outside, and Escape

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function Select({ value, options, onChange, placeholder, disabled, className = '' }) {
  const [open,   setOpen]   = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const btnRef  = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const opt = options[active];
        if (opt) { onChange(opt.value); setOpen(false); }
      }
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown',   onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown',   onKey);
    };
  }, [open, active, options, onChange]);

  // Sync active index with current selection when opening.
  useEffect(() => {
    if (open) {
      const i = options.findIndex((o) => o.value === value);
      setActive(i >= 0 ? i : 0);
    }
  }, [open, value, options]);

  return (
    <div ref={wrapRef} className={`oc-select ${className}`}>
      <button
        ref={btnRef}
        type="button"
        className="oc-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="oc-select-trigger-label">
          {selected ? selected.label : <span className="oc-select-placeholder">{placeholder ?? 'Select…'}</span>}
        </span>
        <ChevronDown size={14} className={`oc-select-chevron${open ? ' open' : ''}`} />
      </button>

      {open && (
        <div className="oc-select-menu" role="listbox">
          {options.length === 0 && (
            <div className="oc-select-empty">No options</div>
          )}
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`oc-select-option${i === active ? ' is-active' : ''}${isSel ? ' is-selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                title={opt.label}
              >
                <span className="oc-select-option-label">{opt.label}</span>
                {isSel && <Check size={14} className="oc-select-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
