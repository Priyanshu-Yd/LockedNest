'use strict';

/**
 * SafeNest appearance — dark / light theme.
 * Persists in localStorage; does not touch Nest security settings.
 */
window.SafeNestTheme = (() => {
  const KEY = 'safenest-theme';
  const listeners = new Set();

  function normalize(theme) {
    return theme === 'light' ? 'light' : 'dark';
  }

  function get() {
    try {
      return normalize(localStorage.getItem(KEY));
    } catch {
      return 'dark';
    }
  }

  function apply(theme) {
    const next = normalize(theme);
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // ignore quota / private mode
    }
    for (const fn of listeners) {
      try {
        fn(next);
      } catch {
        // ignore listener errors
      }
    }
    return next;
  }

  function toggle() {
    return apply(get() === 'light' ? 'dark' : 'light');
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Apply early to avoid flash
  apply(get());

  return { get, apply, toggle, onChange, KEY };
})();
