import { useSyncExternalStore } from 'react';

/** The playback speeds to choose from */
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type Speed = (typeof SPEEDS)[number];

const DEFAULT: Speed = 1;

// localStorage like the other display settings: this browser's, read at once.
const STORAGE_KEY = 'podcastSpeed';

let speed = stored();
const listeners = new Set<() => void>();

/** The speed episodes play at */
export function useSpeed(): Speed {
  return useSyncExternalStore(subscribe, () => speed);
}

export function setSpeed(value: Speed) {
  if (value === speed) return;
  speed = value;
  try {
    if (value === DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(value));
  } catch (err) {
    console.warn(err);
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function stored(): Speed {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (SPEEDS.includes(value as Speed)) return value as Speed;
  } catch {}
  return DEFAULT;
}
