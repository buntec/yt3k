import { useSyncExternalStore } from 'react';
import { getShows, movedFeeds } from './shows';

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
  const moved = await currentKey(key);
  await load();
  return progress[moved];
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

/** Held to change the progress, so tabs saving at once don't lose each other's */
const LOCK = 'yt3k-podcast-progress';

/** Replaces the stored progress with what `change` makes of it as it is now, unless undefined. */
async function write(change: (current: ProgressMap) => ProgressMap | undefined) {
  await load();
  await navigator.locks.request(LOCK, async () => {
    const next = change(await progressItem.getValue());
    if (!next) return;
    publish(next);
    await progressItem.setValue(next);
  });
}

/** The key of the episode at the address its show moved to, if it moved */
function movedKey(key: string, moves: Map<string, string>): string {
  // Feed URLs have no spaces, which URLs encode.
  const space = key.indexOf(' ');
  const to = moves.get(key.slice(0, space));
  return to ? episodeKey(to, key.slice(space + 1)) : key;
}

/**
 * The key an episode's progress is kept under now: at its show's new address
 * once it moved, e.g. for a player still playing it from the old one.
 */
async function currentKey(key: string): Promise<string> {
  return movedKey(key, movedFeeds(await getShows()));
}

async function set(
  key: string,
  change: (current: Progress | undefined) => Omit<Progress, 'at'> | undefined,
) {
  const moved = await currentKey(key);
  await write((current) => {
    const now = Date.now();
    const value = change(current[moved]);
    const kept = Object.entries(current).filter(([k, p]) => k !== moved && now - p!.at < MAX_AGE);
    return Object.fromEntries(value ? [...kept, [moved, { ...value, at: now }]] : kept);
  });
}

/**
 * Keeps the progress of shows' episodes when they move to other feeds, whose
 * episodes keep their IDs, as podcast hosts keep them in a move: those moved
 * here, in `moves`, and those whose moves synced from elsewhere. Of an
 * episode with progress at both addresses, the newest stays.
 */
export async function moveProgress(moves: Iterable<[from: string, to: string]> = []) {
  const all = new Map([...movedFeeds(await getShows()), ...moves]);
  if (all.size === 0) return;
  await write((current) => {
    let isMoved = false;
    const next: ProgressMap = { ...current };
    for (const [key, value] of Object.entries(current)) {
      const moved = movedKey(key, all);
      if (moved === key) continue;
      const there = next[moved];
      if (!there || there.at < value!.at) next[moved] = value;
      delete next[key];
      isMoved = true;
    }
    return isMoved ? next : undefined;
  });
}

/** Keeps where playback is, counting it as played near the end. */
export function savePosition(key: string, position: number, duration: number | undefined) {
  const isPlayed = duration !== undefined && duration > 0 && position >= duration - END_MARGIN;
  return set(key, () => ({ position: isPlayed ? 0 : position, duration, isPlayed }));
}

/** Marks the episode as played, or as not played and back at its start. */
export function setPlayed(key: string, isPlayed: boolean) {
  return set(key, (current) =>
    isPlayed ? { position: 0, duration: current?.duration, isPlayed } : undefined,
  );
}
