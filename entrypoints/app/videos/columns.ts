import { useSyncExternalStore } from 'react';

/** The choices for how many videos a row of the grid holds */
export const COLUMN_CHOICES = [3, 4, 5, 6, 7, 8] as const;

export type Columns = (typeof COLUMN_CHOICES)[number];

const DEFAULT: Columns = 4;

// localStorage, like the theme, so the grid has its width on first render.
const STORAGE_KEY = 'columns';

const listeners = new Set<() => void>();

/** The stored number of videos per row, kept in sync with other tabs. */
export function useColumns(): Columns {
  return useSyncExternalStore(subscribe, stored);
}

export function setColumns(columns: Columns) {
  try {
    if (columns === DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(columns));
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

function stored(): Columns {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (COLUMN_CHOICES.includes(value as Columns)) return value as Columns;
  } catch {}
  return DEFAULT;
}
