import { useEffect, useMemo } from 'react';
import { Clock } from 'lucide-react';
import type { ListedVideo } from '@/utils/youtube';
import { useChannelFilter } from '../subscriptions/groups';
import { GroupsNav } from '../subscriptions/GroupControls';
import { useSubscriptions } from '../subscriptions/store';
import { type VideoAction, VideoListView } from '../videos/VideoListView';
import { saveToWatchLater } from '../watch-later/store';
import { live } from './store';

/** The subscribed channels' live streams, filtered by the groups on Subs. */
export function LivePage() {
  const { channels, status, isRefreshing } = useSubscriptions();
  const { videos } = live.use();
  const { filter, group, includes } = useChannelFilter();

  // The groups count the channels that are live.
  const liveChannels = useMemo(() => {
    const ids = new Set(videos.map((v) => v.channel?.id));
    return channels.filter((c) => ids.has(c.id));
  }, [channels, videos]);

  // Looks for streams again every minute while the page is shown and right
  // away on coming back to the browser tab, after loading the feeds that got
  // old, which tell what channels are live. Leaving the page has it look
  // again when it's next shown.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void live.refresh();
    };
    const timer = setInterval(refreshIfVisible, 60 * 1000);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
      live.invalidate();
    };
  }, []);

  return (
    <VideoListView
      title="Live"
      list={live}
      // Checking every channel for streams can take a while after some time away.
      loadingText={isRefreshing && status.text ? status.text : 'Looking for live streams…'}
      empty={{
        title: 'Nobody is live',
        description: 'Live streams of the channels you subscribe to show up here.',
      }}
      actions={actions}
      start={<GroupsNav channels={liveChannels} filter={filter} />}
      include={(video) => includes(video.channel?.id ?? '')}
      filteredEmpty={
        filter === 'ungrouped'
          ? { title: 'Every live channel is in a group' }
          : { title: `Nobody in ${group?.name} is live` }
      }
    />
  );
}

function actions(video: ListedVideo): VideoAction[] {
  return [
    {
      label: 'Save to Watch later',
      icon: Clock,
      run: (showToast) => void saveToWatchLater(video, showToast),
    },
  ];
}
