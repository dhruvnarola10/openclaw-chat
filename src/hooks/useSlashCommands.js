// Filters a slash-command catalog by the current input text and owns the
// popup highlight + keyboard navigation index. The catalog is injected
// (live from the gateway via useGatewayCommands) and falls back to the
// static bundle so this still works standalone.

import { useCallback, useMemo, useState } from 'react';
import { SLASH_COMMANDS } from '../utils/slashCommands.js';

export function useSlashCommands({ input, commands = SLASH_COMMANDS }) {
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const results = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    const list = Array.isArray(commands) && commands.length ? commands : SLASH_COMMANDS;
    // Match the typed prefix against the command and any text aliases so
    // "/m" surfaces "/model" when the gateway reports it as an alias.
    return list.filter((c) => {
      if (c.cmd.slice(1).toLowerCase().startsWith(q)) return true;
      return Array.isArray(c.aliases)
        && c.aliases.some((a) => String(a).replace(/^\/+/, '').toLowerCase().startsWith(q));
    });
  }, [input, commands]);

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
