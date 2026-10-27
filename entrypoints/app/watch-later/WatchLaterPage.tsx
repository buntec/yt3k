import { Trash2 } from 'lucide-react';
import type { ListedVideo } from '@/utils/youtube';
import { type VideoAction, VideoListView } from '../videos/VideoListView';
import { removeFromList, watchLater } from './store';

/** The user's Watch later playlist on YouTube */
export function WatchLaterPage() {
  return (
    <VideoListView
      title="Watch later"
      list={watchLater}
      loadingText="Loading Watch later…"
      empty={{
        title: 'Nothing saved for later',
        description: 'Videos you save to Watch later, here or on YouTube, show up here.',
      }}
      actions={actions}
    />
  );
}

function actions(video: ListedVideo): VideoAction[] {
  return [
    { label: 'Remove from Watch later', icon: Trash2, run: () => removeFromList(video) },
  ];
}
