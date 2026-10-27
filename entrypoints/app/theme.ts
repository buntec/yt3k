import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

// localStorage rather than extension storage so public/theme-init.js can read
// it synchronously before first paint.
const STORAGE_KEY = 'theme';

const listeners = new Set<() => void>();

/** The stored theme mode, kept in sync with changes made in other tabs. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, stored);
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch (err) {
    console.warn(err);
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  // Follow changes made on the page in other tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  listeners.add(onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function stored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {}
  return 'system';
}
