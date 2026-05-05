// Theme manager: dark | light | system.
//
// Stores the user's choice in localStorage and applies it as a
// `data-theme` attribute on <html> so the CSS variables can pick it up.
// The `system` mode delegates to OS preference via @media in the stylesheet.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'leo-theme';
const VALID = ['dark', 'light', 'system'];

function applyTheme(mode) {
  const html = document.documentElement;
  html.setAttribute('data-theme', mode);
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return VALID.includes(raw) ? raw : 'dark';
  } catch {
    return 'dark';
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(read);

  // Apply on mount + on every change.
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore quota */ }
  }, [theme]);

  // Cycle: dark → light → system → dark
  const cycleTheme = useCallback(() => {
    setTheme((t) => {
      const i = VALID.indexOf(t);
      return VALID[(i + 1) % VALID.length];
    });
  }, []);

  return { theme, setTheme, cycleTheme };
}

// Apply immediately on script load to avoid flash-of-wrong-theme.
applyTheme(read());
