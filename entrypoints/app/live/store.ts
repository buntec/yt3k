import {
  type VideoListPage,
  fetchLiveStreams,
  fetchSubscriptionsFeedLiveStreams,
} from '@/utils/youtube';
import { loadSubscriptions } from '../subscriptions/store';
import { createVideoList } from '../videos/list';

// Not stored, like the recommendations: streams come and go by the minute.
export const live = createVideoList({ first: loadLiveStreams });

/**
 * The live streams of the subscribed channels, by channel name. The channels
 * the feeds on Subs found live have theirs read from their Live tabs. The
 * feeds can be a few minutes old, so streams that started since are taken from
 * the top of YouTube's subscriptions feed, which only lists recent ones.
 */
async function loadLiveStreams(): Promise<VideoListPage> {
  const { channels, feeds } = await loadSubscriptions();
  const [recent, ...byChannel] = await Promise.all([
    fetchSubscriptionsFeedLiveStreams(),
    ...channels
      .filter((c) => feeds[c.id]?.isLive)
      .map((c) =>
        // One channel failing shouldn't hide the others' streams.
        fetchLiveStreams(c).catch((err) => {
          console.warn(c.title, err);
          return [];
        }),
      ),
  ]);
  const seen = new Set<string>();
  const videos = [...byChannel.flat(), ...recent].filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  // Stable, unlike viewer counts, so the list doesn't reshuffle on every update
  videos.sort((a, b) => (a.channel?.title ?? '').localeCompare(b.channel?.title ?? ''));
  return { videos };
}
