import { useEffect } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import type { ListedVideo } from '@/utils/youtube';
import { type VideoAction, VideoListView } from '../videos/VideoListView';
import { saveToWatchLater } from '../watch-later/store';
import { history, removeFromHistory } from './store';

/** The user's watch history on YouTube, by the day each video was watched */
export function HistoryPage() {
  // Watching anywhere, also on other devices, adds to it: load it again each
  // time the page is shown. The first time, showing the list already did.
  useEffect(() => {
    void history.refresh();
  }, []);

  return (
    <VideoListView
      title="History"
      list={history}
      loadingText="Loading history…"
      empty={{
        title: 'No watch history',
        description: 'Videos you watch on YouTube show up here, unless watch history is paused.',
      }}
      actions={actions}
    />
  );
}

function actions(video: ListedVideo): VideoAction[] {
  const items: VideoAction[] = [
    {
      label: 'Save to Watch later',
      icon: Clock,
      run: (showToast) => void saveToWatchLater(video, showToast),
    },
  ];
  if (video.feedback.removeFromHistory) {
    items.push({
      label: 'Remove from watch history',
      icon: Trash2,
      run: () => removeFromHistory(video),
    });
  }
  return items;
}
