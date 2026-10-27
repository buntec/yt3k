import { type ListedVideo, fetchHistory, fetchMoreHistory, sendFeedback } from '@/utils/youtube';
import { createVideoList } from '../videos/list';

export const history = createVideoList({ first: fetchHistory, more: fetchMoreHistory });

/**
 * Removes the video from the user's watch history, like the item in YouTube's
 * own menu. YouTube offers no way to undo that.
 */
export function removeFromHistory(video: ListedVideo) {
  const action = video.feedback.removeFromHistory;
  if (!action) return;
  void history.remove(video.id, {
    message: 'Removed from watch history',
    send: () => sendFeedback(action),
  });
}
