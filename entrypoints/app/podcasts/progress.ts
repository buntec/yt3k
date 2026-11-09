import { useSyncExternalStore } from 'react';

/** How far the user got into an episode */
export interface Progress {
  /** Seconds into it */
  position: number;
  /** Its length in seconds, as the player found it */
  duration?: number;
  /** Finished, or marked as played */
  isPlayed?: boolean;
  /** When last changed, in ms since the epoch */
  at: number;
}

/** Progress by episode key, as made by episodeKey */
export type ProgressMap = Partial<Record<string, Progress>>;

/** Progress untouched this long is forgotten, keeping storage from growing forever */
const MAX_AGE = 365 * 24 * 60 * 60 * 1000;
/** Played this close to the end counts as played */
const END_MARGIN = 30;

// This browser's only: positions change every few seconds while playing,
// too often to sync through Google Drive.
const progressItem = storage.defineItem<ProgressMap>('local:podcastProgress', {
  fallback: {},
});

let progress: ProgressMap = {};
let isLoaded = false;
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;

/** The key of an episode of a show, which its progress is stored under */
export function episodeKey(feedUrl: string, episodeId: string) {
  return `${feedUrl} ${episodeId}`;
}

export function useProgress(): ProgressMap {
  void load();
  return useSyncExternalStore(subscribe, () => progress);
}

/** An episode's progress, once loaded */
export async function getProgress(key: string): Promise<Progress | undefined> {
  await load();
  return progress[key];
}

function load(): Promise<void> {
  loading ??= (async () => {
    // Followed from other tabs, e.g. an episode played in one of them
    progressItem.watch((value) => publish(value));
    const stored = await progressItem.getValue();
    if (!isLoaded) publish(stored);
  })();
  return loading;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function publish(value: ProgressMap) {
  progress = value;
  isLoaded = true;
  for (const listener of listeners) listener();
}

async function set(key: string, value: Omit<Progress, 'at'> | undefined) {
  await load();
  const now = Date.now();
  const kept = Object.entries(progress).filter(([k, p]) => k !== key && now - p!.at < MAX_AGE);
  const next = Object.fromEntries(value ? [...kept, [key, { ...value, at: now }]] : kept);
  publish(next);
  await progressItem.setValue(next);
}

/**
 * Keeps the progress of a show's episodes when it moves to another feed,
 * whose episodes keep their IDs, as podcast hosts keep them in a move.
 */
export async function moveProgress(fromFeedUrl: string, toFeedUrl: string) {
  await load();
  const prefix = episodeKey(fromFeedUrl, '');
  let isMoved = false;
  const next: ProgressMap = { ...progress };
  for (const [key, value] of Object.entries(progress)) {
    if (!key.startsWith(prefix)) continue;
    const moved = episodeKey(toFeedUrl, key.slice(prefix.length));
    // Unless the episode has progress at the new address already
    if (!next[moved]) next[moved] = value;
    delete next[key];
    isMoved = true;
  }
  if (!isMoved) return;
  publish(next);
  await progressItem.setValue(next);
}

/** Keeps where playback is, counting it as played near the end. */
export function savePosition(key: string, position: number, duration: number | undefined) {
  const isPlayed = duration !== undefined && duration > 0 && position >= duration - END_MARGIN;
  return set(key, { position: isPlayed ? 0 : position, duration, isPlayed });
}

/** Marks the episode as played, or as not played and back at its start. */
export function setPlayed(key: string, isPlayed: boolean) {
  if (!isPlayed) return set(key, undefined);
  return set(key, { position: 0, duration: progress[key]?.duration, isPlayed });
}
