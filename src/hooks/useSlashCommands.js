// Filters the static slash-command catalog by the current input text and
// owns the popup highlight + keyboard navigation index.

import { useCallback, useMemo, useState } from 'react';
import { SLASH_COMMANDS } from '../utils/slashCommands.js';

export function useSlashCommands({ input }) {
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const results = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(q));
  }, [input]);

  const open = !dismissed && results.length > 0;

  // Reset state when the input changes — wrapped so callers can call this
  // alongside their own onChange handler.
  const onInputChange = useCallback(() => {
    setDismissed(false);
    setIdx(0);
  }, []);

  /**
   * Handle keyboard nav. Returns `true` if the event was consumed
   * (i.e. caller should NOT process its own Enter/Tab/Esc handling).
   */
  const handleKey = useCallback((e, applySelection) => {
    if (!open) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, results.length - 1));
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      applySelection(results[idx] ?? results[0]);
      return true;
    }
    if (e.key === 'Escape') {
      setDismissed(true);
      return true;
    }
    return false;
  }, [open, results, idx]);

  return { results, open, idx, setIdx, onInputChange, handleKey };
}
