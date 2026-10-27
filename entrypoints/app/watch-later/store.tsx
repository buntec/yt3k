import { Button } from '@astryxdesign/core/Button';
import {
  type ListedVideo,
  addToWatchLater,
  fetchMoreWatchLater,
  fetchWatchLater,
  removeFromWatchLater,
} from '@/utils/youtube';
import { createVideoList } from '../videos/list';
import type { ShowToast } from '../videos/VideoListView';

export const watchLater = createVideoList({ first: fetchWatchLater, more: fetchMoreWatchLater });

/** Saves a video from elsewhere to Watch later, with Undo in a toast. */
export async function saveToWatchLater(video: { id: string }, showToast: ShowToast) {
  try {
    await addToWatchLater(video.id);
  } catch (err) {
    console.warn(err);
    showToast({ type: 'error', body: "Couldn't save to Watch later" });
    return;
  }
  watchLater.invalidate();
  const hide = showToast({
    body: 'Saved to Watch later',
    uniqueID: `watch-later-${video.id}`,
    // Long enough to reach for Undo
    autoHideDuration: 10_000,
    endContent: (
      <Button
        label="Undo"
        size="sm"
        variant="ghost"
        onClick={async () => {
          hide();
          try {
            await removeFromWatchLater(video);
            watchLater.invalidate();
          } catch (err) {
            console.warn(err);
            showToast({ type: 'error', body: "Couldn't remove it from Watch later" });
          }
        }}
      />
    ),
  });
}

/** Removes a video shown in the Watch later list, with Undo in its place. */
export function removeFromList(video: ListedVideo) {
  void watchLater.remove(video.id, {
    message: 'Removed from Watch later',
    send: () => removeFromWatchLater(video),
    // Saving it again puts it back, though at the top of the playlist.
    undo: () => addToWatchLater(video.id),
  });
}
