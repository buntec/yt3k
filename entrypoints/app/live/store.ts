import {
  type VideoListPage,
  fetchLiveStreams,
  fetchSubscriptionsFeedLiveStreams,
} from '@/utils/youtube';
import { loadFreshSubscriptions } from '../subscriptions/store';
import { createVideoList } from '../videos/list';

// Not stored, like the recommendations: streams come and go by the minute.
export const live = createVideoList({ first: loadLiveStreams });

/**
 * The live streams of the subscribed channels, by channel name. The channels
 * the feeds on Subs found live have theirs read from their Live tabs, once
 * the feeds that got old are loaded again. Streams that started since are
 * taken from the top of YouTube's subscriptions feed, which only lists recent
 * ones.
 */
async function loadLiveStreams(): Promise<VideoListPage> {
  // One source failing shouldn't hide the others' streams, unless all fail.
  let failures = 0;
  let lastError: unknown;
  const settle = <T>(request: Promise<T[]>, source: string) =>
    request.catch((err: unknown) => {
      failures++;
      lastError = err;
      console.warn(source, err);
      return [];
    });

  // Doesn't need the feeds, so it doesn't wait for them.
  const recent = settle(fetchSubscriptionsFeedLiveStreams(), 'Subscriptions feed');
  const { channels, feeds } = await loadFreshSubscriptions();
  const liveChannels = channels.filter((c) => feeds[c.id]?.isLive);
  const [byChannel, recentStreams] = await Promise.all([
    Promise.all(liveChannels.map((c) => settle(fetchLiveStreams(c), c.title))),
    recent,
  ]);
  if (failures === liveChannels.length + 1) throw lastError;

  const seen = new Set<string>();
  const videos = [...byChannel.flat(), ...recentStreams].filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  // Stable, unlike viewer counts, so the list doesn't reshuffle on every update
  videos.sort((a, b) => (a.channel?.title ?? '').localeCompare(b.channel?.title ?? ''));
  return { videos };
}
