import { useSyncExternalStore } from 'react';
import {
  type Channel,
  type Video,
  fetchLatestVideos,
  fetchSubscriptions,
  unsubscribe,
} from '@/utils/youtube';
import { MAX_VIDEOS_PER_CHANNEL } from './videosPerChannel';

export interface Feed {
  fetchedAt: number;
  videos: Video[];
  /** Whether the channel was streaming live when the feed was fetched */
  isLive: boolean;
}

export type Feeds = Partial<Record<string, Feed>>;

export interface SubscriptionsState {
  channels: Channel[];
  feeds: Feeds;
  status: { text: string; isError: boolean };
  isRefreshing: boolean;
}

const FEED_MAX_AGE = 15 * 60 * 1000;
const CONCURRENT_REQUESTS = 8;

const subscriptionsItem = storage.defineItem<Channel[]>('local:subscriptions', {
  fallback: [],
});
const feedsItem = storage.defineItem<Feeds>('local:feeds', {
  fallback: {},
  version: 8,
  migrations: {
    // Version 2 adds view counts: load all feeds again rather than show
    // videos without them until each feed gets old enough to be refreshed.
    2: () => ({}),
    // Version 3 reads feeds from YouTube's API rather than its RSS feeds,
    // whose outages stored empty feeds: load them all again.
    3: () => ({}),
    // Version 4 adds durations, loaded again like the view counts.
    4: () => ({}),
    // Version 5 adds how much of each video was watched.
    5: () => ({}),
    // Version 6 dates videos in the middle of their ages' ranges rather than
    // at their start, which sorting by age relies on.
    6: () => ({}),
    // Version 7 keeps 5 videos per channel rather than 3, of which the
    // page shows as many as chosen.
    7: () => ({}),
    // Version 8 adds whether each channel is live, which Live relies on to
    // find all streams.
    8: () => ({}),
  },
});

// Lives outside React so switching pages keeps the data and doesn't refetch
// it; the first page that uses it loads it.
let state: SubscriptionsState = {
  channels: [],
  feeds: {},
  status: { text: '', isError: false },
  isRefreshing: false,
};
const listeners = new Set<() => void>();
let cached: Promise<void> | undefined;

export function useSubscriptions(): SubscriptionsState {
  void loadSubscriptions();
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * The subscriptions and feeds as they are once those stored earlier are
 * loaded, which also starts bringing them up to date.
 */
export async function loadSubscriptions(): Promise<SubscriptionsState> {
  cached ??= load();
  await cached;
  return state;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function update(patch: Partial<SubscriptionsState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setStatus(text: string, isError = false) {
  update({ status: { text, isError } });
}

async function load() {
  // Show cached data right away, then bring it up to date.
  const [channels, feeds] = await Promise.all([
    subscriptionsItem.getValue(),
    feedsItem.getValue(),
  ]);
  update({ channels, feeds });
  void refresh(false);
}

/**
 * Loads the subscriptions again, then their feeds: all of them if forced,
 * else only those that got old.
 */
export function refresh(force: boolean) {
  return reload({ subscriptions: true, force });
}

/** Loads the feeds that got old again, keeping the list of subscriptions. */
export function refreshStaleFeeds() {
  return reload({ subscriptions: false, force: false });
}

async function reload(options: { subscriptions: boolean; force: boolean }) {
  if (state.isRefreshing) return;
  // Leave the page alone when there's nothing to do, as on most timed updates.
  if (!options.subscriptions && staleChannels(false).length === 0) return;
  update({ isRefreshing: true });
  // Mutated as feeds arrive and published in batches by scheduleUpdate().
  let feeds = state.feeds;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;

  /** Re-render and persist progress at most every half second while loading. */
  const scheduleUpdate = () => {
    updateTimer ??= setTimeout(() => {
      updateTimer = undefined;
      update({ feeds: { ...feeds } });
      void feedsItem.setValue(feeds);
    }, 500);
  };

  try {
    if (options.subscriptions) {
      setStatus('Loading subscriptions…');
      try {
        const channels = await fetchSubscriptions();
        await subscriptionsItem.setValue(channels);
        feeds = Object.fromEntries(
          channels.filter((c) => feeds[c.id]).map((c) => [c.id, feeds[c.id]]),
        );
        update({ channels, feeds });
      } catch (err) {
        // Without a fresh list, keep going with the cached one if there is one.
        if (state.channels.length === 0) throw err;
        console.warn(err);
      }
    }

    feeds = { ...feeds };
    const stale = staleChannels(options.force);
    let done = 0;
    let failed = 0;
    await forEachConcurrently(stale, CONCURRENT_REQUESTS, async (channel) => {
      try {
        const latest = await fetchLatestVideos(channel.id, MAX_VIDEOS_PER_CHANNEL);
        feeds[channel.id] = { fetchedAt: Date.now(), ...latest };
      } catch (err) {
        failed++;
        console.warn(channel.title, err);
      }
      setStatus(`Updating ${++done} of ${stale.length}…`);
      scheduleUpdate();
    });

    clearTimeout(updateTimer);
    await feedsItem.setValue(feeds);
    update({ feeds });
    setStatus(
      `${state.channels.length} channels` +
        (failed ? ` · ${failed} feeds failed to load` : ''),
    );
  } catch (err) {
    clearTimeout(updateTimer);
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    update({ isRefreshing: false });
  }
}

function staleChannels(force: boolean) {
  return state.channels.filter(
    (c) => force || Date.now() - (state.feeds[c.id]?.fetchedAt ?? 0) > FEED_MAX_AGE,
  );
}

/**
 * Loads one channel's videos again, e.g. after watching one of them here, to
 * show how much of it was watched.
 */
export async function refreshChannel(channelId: string) {
  try {
    const latest = await fetchLatestVideos(channelId, MAX_VIDEOS_PER_CHANNEL);
    const feeds = { ...state.feeds, [channelId]: { fetchedAt: Date.now(), ...latest } };
    await feedsItem.setValue(feeds);
    update({ feeds });
  } catch (err) {
    console.warn(err);
  }
}

/** Unsubscribes and drops the channel from the list; throws if that fails. */
export async function unsubscribeFrom(channel: Channel) {
  try {
    await unsubscribe(channel);
  } catch (err) {
    setStatus(`Could not unsubscribe from ${channel.title}`, true);
    throw err;
  }
  const channels = state.channels.filter((c) => c.id !== channel.id);
  const { [channel.id]: _, ...feeds } = state.feeds;
  await Promise.all([
    subscriptionsItem.setValue(channels),
    feedsItem.setValue(feeds),
  ]);
  update({ channels, feeds });
  setStatus(`Unsubscribed from ${channel.title}`);
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
