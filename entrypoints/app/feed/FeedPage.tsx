import { Ban, CircleMinus, Clock } from 'lucide-react';
import type { ListedVideo } from '@/utils/youtube';
import { type VideoAction, VideoListView } from '../videos/VideoListView';
import { saveToWatchLater } from '../watch-later/store';
import { dismiss, feed } from './store';

/** Recommended videos, like the Home page on YouTube. */
export function FeedPage() {
  return (
    <VideoListView
      title="Feed"
      list={feed}
      loadingText="Loading recommendations…"
      empty={{
        title: 'No recommendations',
        description: "Make sure you're logged in to YouTube in this browser.",
      }}
      actions={actions}
    />
  );
}

/** The items of YouTube's own menu on Home that yt3k supports */
function actions(video: ListedVideo): VideoAction[] {
  const items: VideoAction[] = [
    {
      label: 'Save to Watch later',
      icon: Clock,
      run: (showToast) => void saveToWatchLater(video, showToast),
    },
  ];
  if (video.feedback.notInterested) {
    items.push({ label: 'Not interested', icon: Ban, run: () => dismiss(video, 'video') });
  }
  if (video.feedback.dontRecommendChannel) {
    items.push({
      label: "Don't recommend channel",
      icon: CircleMinus,
      run: () => dismiss(video, 'channel'),
    });
  }
  return items;
}
