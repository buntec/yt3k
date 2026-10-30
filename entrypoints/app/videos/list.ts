import { useSyncExternalStore } from 'react';
import type { ListedVideo, VideoListPage } from '@/utils/youtube';

export interface VideoListState {
  videos: ListedVideo[];
  /** Token for the next page, if there is one */
  continuation?: string;
  loading: 'idle' | 'refresh' | 'more';
  /** Loading failed. Also stops loading more on scroll. */
  error?: string;
  /** Removing a video, or undoing that, failed */
  removalError?: string;
  /** Videos the user took out of the list, by video ID */
  removals: Partial<Record<string, Removal>>;
}

/** A video the user took out of the list, shown as a message with Undo */
export interface Removal {
  message: string;
  /** Channel whose other videos are hidden too */
  channelUrl?: string;
  undo?: () => Promise<void>;
  status: 'sending' | 'sent' | 'undoing';
}

export type VideoList = ReturnType<typeof createVideoList>;

/**
 * A list of videos loaded page by page from YouTube. It lives outside React,
 * so switching pages keeps it, and loads when a page first uses it.
 */
export function createVideoList(load: {
  first: () => Promise<VideoListPage>;
  /** Lists that come in one piece have no continuation and need none */
  more?: (continuation: string) => Promise<VideoListPage>;
}) {
  let state: VideoListState = { videos: [], loading: 'idle', removals: {} };
  const listeners = new Set<() => void>();
  let isStale = true;

  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  };

  function update(patch: Partial<VideoListState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function setRemoval(videoId: string, removal: Removal | undefined) {
    const { [videoId]: _, ...others } = state.removals;
    update({ removals: removal ? { ...others, [videoId]: removal } : others });
  }

  const list = {
    use(): VideoListState {
      if (isStale) {
        isStale = false;
        // Nothing renders this list yet, so updating during render is safe,
        // and the first render already shows it loading.
        void list.refresh();
      }
      return useSyncExternalStore(subscribe, () => state);
    },

    /** Loads the list again the next time a page shows it. */
    invalidate() {
      isStale = true;
    },

    /** Replaces the list with a fresh first page. */
    async refresh() {
      if (state.loading !== 'idle') return;
      update({ loading: 'refresh', error: undefined });
      try {
        const page = await load.first();
        update({
          videos: page.videos,
          continuation: page.continuation,
          removals: {},
          removalError: undefined,
        });
      } catch (err) {
        update({ error: errorMessage(err) });
      } finally {
        update({ loading: 'idle' });
      }
    },

    /** Appends the next page, skipping videos already in the list. */
    async loadMore() {
      if (state.loading !== 'idle' || !state.continuation || !load.more) return;
      update({ loading: 'more', error: undefined });
      try {
        const page = await load.more(state.continuation);
        const seen = new Set(state.videos.map((v) => v.id));
        update({
          videos: [...state.videos, ...page.videos.filter((v) => !seen.has(v.id))],
          continuation: page.continuation,
        });
      } catch (err) {
        update({ error: errorMessage(err) });
      } finally {
        update({ loading: 'idle' });
      }
    },

    /**
     * Takes the video out of the list right away and tells YouTube with
     * `send`. The video comes back if that fails.
     */
    async remove(
      videoId: string,
      { send, ...removal }: Omit<Removal, 'status'> & { send: () => Promise<void> },
    ) {
      if (state.removals[videoId]) return;
      setRemoval(videoId, { ...removal, status: 'sending' });
      update({ removalError: undefined });
      try {
        await send();
        // Unless a refresh replaced the list in the meantime
        if (state.removals[videoId]) setRemoval(videoId, { ...removal, status: 'sent' });
      } catch (err) {
        setRemoval(videoId, undefined);
        update({ removalError: `That didn't work: ${errorMessage(err)}` });
      }
    },

    /** Takes back a removal and shows the video again. */
    async undoRemoval(videoId: string) {
      const removal = state.removals[videoId];
      if (removal?.status !== 'sent' || !removal.undo) return;
      setRemoval(videoId, { ...removal, status: 'undoing' });
      update({ removalError: undefined });
      try {
        await removal.undo();
        setRemoval(videoId, undefined);
      } catch (err) {
        if (state.removals[videoId]) setRemoval(videoId, removal);
        update({ removalError: `Undo didn't work: ${errorMessage(err)}` });
      }
    },
  };
  return list;
}

function errorMessage(err: unknown) {
  console.warn(err);
  return err instanceof Error ? err.message : String(err);
}
