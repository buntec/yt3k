import { useSyncExternalStore } from 'react';
import { type Deletions, pruneDeletions } from '../subscriptions/groups';

/** A podcast the user follows, synced between devices like the groups */
export interface Show {
  /** The URL of its RSS feed, which is how it's known everywhere */
  feedUrl: string;
  /** As the feed called it when added, to show until the feed is loaded */
  title: string;
  image?: string;
  /** When it was added, in ms since the epoch, which syncing compares with removals */
  updatedAt: number;
}

/** The shows and when the ones removed were, by feed URL, as synced */
export interface SyncedShows {
  shows: Show[];
  deleted: Deletions;
}

export interface ShowsState {
  /** Sorted by title */
  shows: Show[];
  isLoaded: boolean;
}

// Extension storage like the groups: losing them to cleared site data would
// lose real work. Shows and removals are one item, so they change together.
const showsItem = storage.defineItem<SyncedShows>('local:podcasts', {
  fallback: { shows: [], deleted: {} },
});

/** Held to change the shows, so tabs changing them at once don't lose a change */
const LOCK = 'yt3k-podcasts';

let state: ShowsState = { shows: [], isLoaded: false };
let deleted: Deletions = {};
const listeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
let loading: Promise<void> | undefined;

export function useShows(): ShowsState {
  void load();
  return useSyncExternalStore(subscribe, () => state);
}

/** The shows, once loaded */
export async function getShows(): Promise<Show[]> {
  await load();
  return state.shows;
}

function load(): Promise<void> {
  loading ??= (async () => {
    // Changes made here and in other tabs alike, each written under the lock
    showsItem.watch(publish);
    const stored = await showsItem.getValue();
    if (!state.isLoaded) publish(stored);
  })();
  return loading;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function publish(stored: SyncedShows) {
  deleted = stored.deleted;
  state = {
    shows: [...stored.shows].sort((a, b) => a.title.localeCompare(b.title)),
    isLoaded: true,
  };
  for (const listener of listeners) listener();
}

/** Replaces the stored shows with what `change` makes of them, as they are now. */
async function write(change: (current: SyncedShows) => SyncedShows) {
  await load();
  await navigator.locks.request(LOCK, async () => {
    const next = change(await showsItem.getValue());
    publish(next);
    await showsItem.setValue(next);
  });
}

/** Follows a show; one followed already keeps its date. */
export function addShow(show: Omit<Show, 'updatedAt'>) {
  return addShows([show]);
}

/** Follows the shows, e.g. imported from a file, in one change. */
export async function addShows(shows: Omit<Show, 'updatedAt'>[]) {
  await write((current) => {
    const now = Date.now();
    const followed = new Set(current.shows.map((s) => s.feedUrl));
    const deleted = { ...current.deleted };
    const added: Show[] = [];
    for (const show of shows) {
      if (followed.has(show.feedUrl)) continue;
      followed.add(show.feedUrl);
      // Later than its removal even if this device's clock is behind, or
      // syncing would remove it again
      const updatedAt = Math.max(now, (deleted[show.feedUrl] ?? -1) + 1);
      delete deleted[show.feedUrl];
      added.push({ ...show, updatedAt });
    }
    return added.length ? { shows: [...current.shows, ...added], deleted } : current;
  });
  notifyChanged();
}

/** Stops following a show. Its episodes' progress stays, for following it again. */
export function removeShow(feedUrl: string) {
  return removeShows([feedUrl]);
}

/** Stops following the shows, e.g. on Undo of an import, in one change. */
export async function removeShows(feedUrls: string[]) {
  const removing = new Set(feedUrls);
  await write((current) => {
    const now = Date.now();
    const deleted = { ...current.deleted };
    for (const show of current.shows) {
      if (removing.has(show.feedUrl)) deleted[show.feedUrl] = Math.max(now, show.updatedAt);
    }
    return {
      shows: current.shows.filter((s) => !removing.has(s.feedUrl)),
      deleted: pruneDeletions(deleted, now),
    };
  });
  notifyChanged();
}

/**
 * Follows the show at its new address instead, as one change, so other
 * devices follow it there too. Its removal from the old address keeps a
 * show moving back from coming back.
 */
export async function moveShow(feedUrl: string, to: Omit<Show, 'updatedAt'>) {
  await write((current) => {
    const old = current.shows.find((s) => s.feedUrl === feedUrl);
    if (!old) return current;
    const now = Date.now();
    const deleted = { ...current.deleted, [feedUrl]: Math.max(now, old.updatedAt) };
    const shows = current.shows.filter((s) => s !== old);
    if (!shows.some((s) => s.feedUrl === to.feedUrl)) {
      shows.push({ ...to, updatedAt: Math.max(now, (deleted[to.feedUrl] ?? -1) + 1) });
      delete deleted[to.feedUrl];
    }
    return { shows, deleted: pruneDeletions(deleted, now) };
  });
  notifyChanged();
}

function notifyChanged() {
  for (const listener of changeListeners) listener();
}

/** The shows and removals, once loaded, for syncing */
export async function getSyncedShows(): Promise<SyncedShows> {
  await load();
  return { shows: state.shows, deleted };
}

/**
 * Replaces the shows and removals with what `update` makes of the current
 * ones: unlike following or removing a show here, not a change to sync back.
 */
export async function updateSyncedShows(update: (current: SyncedShows) => SyncedShows) {
  await write(update);
}

/** Calls `listener` after each change made here, e.g. to sync it. */
export function onShowsChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/**
 * Both merged: of a show in both, the copy added last; no show removed after
 * it was added; removals pruned like the groups'. Merging in either order
 * gives the same.
 */
export function mergeShows(a: SyncedShows, b: SyncedShows, now: number): SyncedShows {
  const deletedAt: Deletions = { ...a.deleted };
  for (const [url, at] of Object.entries(b.deleted)) {
    deletedAt[url] = Math.max(deletedAt[url] ?? 0, at);
  }
  const byUrl = new Map<string, Show>();
  for (const show of [...a.shows, ...b.shows]) {
    const other = byUrl.get(show.feedUrl);
    if (!other || isNewer(show, other)) byUrl.set(show.feedUrl, show);
  }
  const shows = [...byUrl.values()]
    .filter((s) => (deletedAt[s.feedUrl] ?? -1) < s.updatedAt)
    .sort((x, y) => (x.feedUrl < y.feedUrl ? -1 : 1));
  return { shows, deleted: pruneDeletions(deletedAt, now) };
}

/** Whether `a` wins over `b`, another copy of the same show */
function isNewer(a: Show, b: Show): boolean {
  // Both devices must pick the same copy whichever each has.
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return JSON.stringify([a.title, a.image]) > JSON.stringify([b.title, b.image]);
}

/** In an order that only depends on the content, so equal content compares equal */
export function canonicalShows({ shows, deleted }: SyncedShows): SyncedShows {
  return {
    shows: [...shows]
      .sort((a, b) => (a.feedUrl < b.feedUrl ? -1 : 1))
      .map(({ feedUrl, title, image, updatedAt }) => ({
        feedUrl,
        title,
        ...(image !== undefined && { image }),
        updatedAt,
      })),
    deleted: Object.fromEntries(Object.entries(deleted).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/** The shows and removals read from a sync file, cleaned up */
export function readShows(shows: unknown, deletions: unknown): SyncedShows {
  const valid = (Array.isArray(shows) ? shows : []).flatMap((value): Show[] => {
    const s = value as Partial<Show> | null;
    if (typeof s?.feedUrl !== 'string' || !s.feedUrl || typeof s.updatedAt !== 'number') {
      return [];
    }
    return [
      {
        feedUrl: s.feedUrl,
        title: typeof s.title === 'string' && s.title ? s.title : s.feedUrl,
        ...(typeof s.image === 'string' && { image: s.image }),
        updatedAt: s.updatedAt,
      },
    ];
  });
  const deleted = Object.fromEntries(
    Object.entries(typeof deletions === 'object' && deletions ? deletions : {}).filter(
      ([, at]) => typeof at === 'number',
    ),
  );
  return { shows: valid, deleted };
}
