import { useSyncExternalStore } from 'react';

// Off by default: YouTube leaves videos that start without a click in the
// player out of the watch history.
const STORAGE_KEY = 'autoplay';

const listeners = new Set<() => void>();

/** Whether embedded videos start on their own, kept in sync with other tabs. */
export function useAutoplay(): boolean {
  return useSyncExternalStore(subscribe, stored);
}

export function setAutoplay(isOn: boolean) {
  try {
    if (isOn) localStorage.setItem(STORAGE_KEY, 'on');
    else localStorage.removeItem(STORAGE_KEY);
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

function stored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}
