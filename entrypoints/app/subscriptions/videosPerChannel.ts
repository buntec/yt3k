import { useSyncExternalStore } from 'react';

/** The choices for how many of each channel's latest videos are shown */
export const VIDEOS_PER_CHANNEL_CHOICES = [1, 2, 3, 4, 5] as const;

export type VideosPerChannel = (typeof VIDEOS_PER_CHANNEL_CHOICES)[number];

/** How many videos are loaded per channel: enough for any of the choices */
export const MAX_VIDEOS_PER_CHANNEL = Math.max(...VIDEOS_PER_CHANNEL_CHOICES);

const DEFAULT: VideosPerChannel = 3;

// localStorage, like the number of columns, so the page has it on first render.
const STORAGE_KEY = 'videosPerChannel';

const listeners = new Set<() => void>();

/** The stored number of videos shown per channel, kept in sync with other tabs. */
export function useVideosPerChannel(): VideosPerChannel {
  return useSyncExternalStore(subscribe, stored);
}

export function setVideosPerChannel(count: VideosPerChannel) {
  try {
    if (count === DEFAULT) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(count));
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

function stored(): VideosPerChannel {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    if (VIDEOS_PER_CHANNEL_CHOICES.includes(value as VideosPerChannel)) {
      return value as VideosPerChannel;
    }
  } catch {}
  return DEFAULT;
}
