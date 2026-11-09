import { useSyncExternalStore } from 'react';
import {
  type FeedValidators,
  type PodcastFeed,
  feedOrigin,
  fetchFeed,
  movedFeedUrl,
  normalizeFeedUrl,
} from '@/utils/podcast';
import {
  DIRECTORY_ORIGIN,
  type DirectoryPodcast,
  applePodcastId,
  browserCountry,
  lookupDirectory,
  searchDirectory,
} from '@/utils/podcastDirectory';
import { parseOpml, serializeOpml } from '@/utils/opml';
import { moveProgress } from './progress';
import {
  type Show,
  addShow,
  addShows,
  getShows,
  getSyncedShows,
  moveShow,
  movedFeeds,
  removeShows,
} from './shows';

/** A show's feed as last loaded */
export interface CachedFeed {
  fetchedAt: number;
  validators: FeedValidators;
  feed: PodcastFeed;
}

export type Feeds = Partial<Record<string, CachedFeed>>;

export interface PodcastsState {
  /** By feed URL */
  feeds: Feeds;
  /** The feeds yt3k may not read yet, e.g. of shows followed in another browser */
  needsAccess: string[];
  /** Where shows moved to, by their feed URL, that yt3k may not read yet */
  movesNeedAccess: Partial<Record<string, string>>;
  /** Why loading each feed failed the last time, by feed URL */
  errors: Partial<Record<string, string>>;
  isRefreshing: boolean;
  status: string;
}

/** How long a feed is shown before it's loaded again */
const FEED_MAX_AGE = 30 * 60 * 1000;
/** Feeds can be megabytes, read on this page: a few at a time */
const CONCURRENT_REQUESTS = 4;

// Not synced: each browser loads the feeds itself.
const feedsItem = storage.defineItem<Feeds>('local:podcastFeeds', { fallback: {} });

let state: PodcastsState = {
  feeds: {},
  needsAccess: [],
  movesNeedAccess: {},
  errors: {},
  isRefreshing: false,
  status: '',
};
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let refreshing: Promise<void> | undefined;
/** The refresh to run after the one under way, asked for meanwhile */
let queued: { promise: Promise<void>; force: boolean } | undefined;

/** The feeds, as stored and then loaded again when they got old */
export function usePodcasts(): PodcastsState {
  void load();
  return useSyncExternalStore(subscribe, () => state);
}

function load(): Promise<void> {
  loading ??= (async () => {
    update({ feeds: await feedsItem.getValue() });
    void refreshFeeds(false);
  })();
  return loading;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function update(patch: Partial<PodcastsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/**
 * Loads the feeds of the shows followed again: all of them if forced, else
 * those that got old or are new, e.g. from another browser. During a refresh,
 * which picked its feeds already, e.g. before a show was followed or a site
 * allowed, runs another after it, which the calls meanwhile all wait for.
 */
export function refreshFeeds(force: boolean): Promise<void> {
  if (!refreshing) {
    refreshing = refreshNow(force).finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }
  if (queued) {
    queued.force ||= force;
  } else {
    const next = { force, promise: Promise.resolve() };
    next.promise = refreshing
      .catch(() => {})
      .then(() => {
        queued = undefined;
        return refreshFeeds(next.force);
      });
    queued = next;
  }
  return queued.promise;
}

async function refreshNow(force: boolean) {
  await load();
  const shows = await getShows();
  const followed = new Set(shows.map((s) => s.feedUrl));
  // Those of shows no longer followed, e.g. removed in another browser
  const feeds: Feeds = Object.fromEntries(
    Object.entries(state.feeds).filter(([url]) => followed.has(url)),
  );
  const errors = { ...state.errors };
  const needsAccess: string[] = [];
  const stale: Show[] = [];
  for (const show of shows) {
    if (!(await mayRead(show.feedUrl))) {
      needsAccess.push(show.feedUrl);
      delete errors[show.feedUrl];
    } else if (force || Date.now() - (feeds[show.feedUrl]?.fetchedAt ?? 0) > FEED_MAX_AGE) {
      stale.push(show);
    }
  }
  update({ feeds, needsAccess, errors });
  if (stale.length === 0) {
    await followMoves();
    update({ status: summary((await getShows()).length) });
    return;
  }

  update({ isRefreshing: true });
  let done = 0;
  await forEachConcurrently(stale, CONCURRENT_REQUESTS, async (show) => {
    const { feedUrl } = show;
    try {
      const res = await fetchFeed(feedUrl, state.feeds[feedUrl]?.validators);
      // Unchanged, the feed already shown, as it was loaded with those validators
      const feed = res.feed ?? state.feeds[feedUrl]?.feed;
      // Into the feeds as they are now, which may have changed meanwhile, e.g.
      // by a show followed while this refresh was under way
      if (feed) {
        const loaded: CachedFeed = { fetchedAt: Date.now(), validators: res.validators, feed };
        update({ feeds: { ...state.feeds, [feedUrl]: loaded } });
      }
      delete errors[feedUrl];
    } catch (err) {
      console.warn(feedUrl, err);
      errors[feedUrl] = err instanceof Error ? err.message : String(err);
    }
    update({ errors: { ...errors }, status: `Updating ${++done} of ${stale.length}…` });
  });
  await feedsItem.setValue(state.feeds);
  await followMoves();
  update({ isRefreshing: false, status: summary((await getShows()).length) });
}

/**
 * Follows the shows whose feeds announced a move at their new addresses,
 * with their progress, once yt3k may read those: until the user allows it,
 * they keep loading from the old ones, which hosts keep serving a while.
 */
async function followMoves() {
  const { shows, deleted } = await getSyncedShows();
  const followed = new Set(shows.map((s) => s.feedUrl));
  const movesNeedAccess: PodcastsState['movesNeedAccess'] = {};
  const moves: [from: string, to: string][] = [];
  for (const show of shows) {
    const feed = state.feeds[show.feedUrl]?.feed;
    const target = movedFeedUrl(show.feedUrl, feed?.newFeedUrl);
    // Not back to an address left, as two feeds naming each other would
    if (!feed || !target || deleted[target] !== undefined) continue;
    if (!followed.has(target) && !(await mayRead(target))) {
      movesNeedAccess[show.feedUrl] = target;
      continue;
    }
    await moveShow(show.feedUrl, {
      feedUrl: target,
      title: feed.title,
      ...((feed.image ?? show.image) && { image: feed.image ?? show.image }),
    });
    moves.push([show.feedUrl, target]);
    // The old feed's episodes show until the new one, loaded next, replaces them.
    const { [show.feedUrl]: old, ...feeds } = state.feeds;
    if (old && !followed.has(target)) feeds[target] = { ...old, fetchedAt: 0, validators: {} };
    update({ feeds });
    followed.add(target);
  }
  update({ movesNeedAccess });
  // Those moved in other browsers too, which synced the shows at their new addresses
  await moveProgress(moves);
  if (moves.length) {
    await feedsItem.setValue(state.feeds);
    // Loads the new feeds
    void refreshFeeds(false);
  }
}

function summary(shows: number) {
  const failed = Object.keys(state.errors).length;
  return (
    `${shows} ${shows === 1 ? 'podcast' : 'podcasts'}` +
    (failed ? ` · ${failed} ${failed === 1 ? 'feed' : 'feeds'} failed to load` : '')
  );
}

/** Whether yt3k may read the feed, which takes the user's permission for its site */
function mayRead(feedUrl: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [feedOrigin(feedUrl)] });
}

/**
 * Follows the podcast whose feed is at the URL typed, after asking the user
 * to let yt3k read feeds from its site. Throws if they don't, or if it isn't
 * a feed.
 *
 * Call it right on the user's click: browsers only ask for permissions
 * while handling one, so nothing may be waited for before asking.
 */
export function followPodcast(input: string): Promise<{ title: string }> {
  let feedUrl: string;
  try {
    feedUrl = normalizeFeedUrl(input);
  } catch (err) {
    return Promise.reject(err);
  }
  const granted = browser.permissions.request({ origins: [feedOrigin(feedUrl)] });
  return (async () => {
    if (!(await granted)) {
      const site = new URL(feedUrl).hostname;
      throw new Error(`yt3k needs your permission to read feeds from ${site}`);
    }
    const { feed, validators } = await fetchFeed(feedUrl);
    if (!feed) throw new Error('The feed came back empty');
    await load();
    const feeds = { ...state.feeds, [feedUrl]: { fetchedAt: Date.now(), validators, feed } };
    const { [feedUrl]: _, ...errors } = state.errors;
    update({ feeds, errors });
    await feedsItem.setValue(feeds);
    const show = { feedUrl, title: feed.title, ...(feed.image && { image: feed.image }) };
    await addShow(show);
    update({ status: summary((await getShows()).length) });
    return show;
  })();
}

/**
 * The podcasts in Apple's directory matching the words typed, or the one an
 * Apple Podcasts link leads to, after asking the user to let yt3k search the
 * directory, the first time. Throws if they don't.
 *
 * Like followPodcast, call it right on the user's click or Enter.
 */
export function searchPodcasts(input: string): Promise<DirectoryPodcast[]> {
  const granted = browser.permissions.request({ origins: [DIRECTORY_ORIGIN] });
  return (async () => {
    if (!(await granted)) {
      throw new Error("yt3k needs your permission to search Apple's podcast directory");
    }
    const id = applePodcastId(input);
    if (id) return lookupDirectory(id);
    return searchDirectory(input.trim(), browserCountry(navigator.languages));
  })();
}

/**
 * Asks the user to let yt3k read the feeds it may not yet, then loads them.
 * Like followPodcast, call it right on the user's click.
 */
export function allowReadingFeeds(): Promise<void> {
  const feeds = [...state.needsAccess, ...Object.values(state.movesNeedAccess)];
  const origins = [...new Set(feeds.flatMap((url) => (url ? [feedOrigin(url)] : [])))];
  const granted = browser.permissions.request({ origins });
  return (async () => {
    await granted;
    await refreshFeeds(false);
  })();
}

/**
 * Stops following the show. The permission to read its site stays, so Undo or
 * following it again needn't ask again.
 */
export function unfollowPodcast(feedUrl: string) {
  return unfollowPodcasts([feedUrl]);
}

async function unfollowPodcasts(feedUrls: string[]) {
  await removeShows(feedUrls);
  const removed = new Set(feedUrls);
  const keep = ([url]: [string, unknown]) => !removed.has(url);
  const feeds: Feeds = Object.fromEntries(Object.entries(state.feeds).filter(keep));
  update({
    feeds,
    errors: Object.fromEntries(Object.entries(state.errors).filter(keep)),
    needsAccess: state.needsAccess.filter((url) => !removed.has(url)),
    status: summary((await getShows()).length),
  });
  await feedsItem.setValue(feeds);
}

/** What importing a file did */
export interface ImportResult {
  /** The feeds of the shows it followed, to unfollow again on Undo */
  added: string[];
  /** Those the file listed that were followed already */
  alreadyFollowed: number;
}

/**
 * Follows the podcasts an OPML file lists, from another podcast app or an
 * export, that aren't followed yet. Throws if it isn't OPML.
 *
 * Choosing a file doesn't let the browser ask for permissions, so the feeds
 * of sites yt3k may not read yet wait for the user to allow them, like
 * those of podcasts followed in another browser.
 */
export async function importPodcasts(text: string): Promise<ImportResult> {
  const listed = parseOpml(text);
  const shows = await getShows();
  // At the addresses their feeds left too, which other apps may still know
  const followed = new Set([...shows.map((s) => s.feedUrl), ...movedFeeds(shows).keys()]);
  const toAdd: Omit<Show, 'updatedAt'>[] = [];
  let alreadyFollowed = 0;
  for (const podcast of listed) {
    let feedUrl: string;
    try {
      feedUrl = normalizeFeedUrl(podcast.feedUrl);
    } catch {
      continue;
    }
    if (followed.has(feedUrl)) {
      alreadyFollowed++;
      continue;
    }
    followed.add(feedUrl);
    toAdd.push({ feedUrl, title: podcast.title ?? new URL(feedUrl).hostname });
  }
  await addShows(toAdd);
  void refreshFeeds(false);
  return { added: toAdd.map((s) => s.feedUrl), alreadyFollowed };
}

/** Unfollows the shows an import followed, e.g. on Undo, wherever they moved since. */
export async function undoImport({ added }: ImportResult) {
  const moves = movedFeeds(await getShows());
  return unfollowPodcasts(added.map((url) => moves.get(url) ?? url));
}

/** The podcasts followed as an OPML file, for other podcast apps or a backup */
export async function exportPodcasts(): Promise<string> {
  const shows = await getShows();
  const podcasts = shows.map((s) => ({
    feedUrl: s.feedUrl,
    title: state.feeds[s.feedUrl]?.feed.title ?? s.title,
  }));
  return serializeOpml(podcasts, new Date());
}

/** Follows a show again that was just unfollowed, e.g. on Undo. */
export async function refollowPodcast(show: Show) {
  const { updatedAt: _, ...again } = show;
  await addShow(again);
  void refreshFeeds(false);
}

async function forEachConcurrently<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
