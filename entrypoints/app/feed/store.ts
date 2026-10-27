import {
  type ListedVideo,
  fetchHomeFeed,
  fetchMoreHomeFeed,
  sendFeedback,
  undoFeedback,
} from '@/utils/youtube';
import { createVideoList } from '../videos/list';

// Unlike subscriptions the recommendations aren't stored: YouTube picks new
// ones on every visit.
export const feed = createVideoList({ first: fetchHomeFeed, more: fetchMoreHomeFeed });

/**
 * Tells YouTube the user isn't interested in the video (`video`) or its
 * channel (`channel`), like the items in YouTube's own menu.
 */
export function dismiss(video: ListedVideo, kind: 'video' | 'channel') {
  const action =
    kind === 'video' ? video.feedback.notInterested : video.feedback.dontRecommendChannel;
  if (!action) return;
  void feed.remove(video.id, {
    message:
      kind === 'video'
        ? 'Video removed'
        : "We won't recommend videos from this channel to you again",
    channelUrl: kind === 'channel' ? video.channel?.url : undefined,
    send: () => sendFeedback(action),
    undo: action.undoToken ? () => undoFeedback(action) : undefined,
  });
}
