import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { extensionHost } from '@/utils/extension';
import type { Video } from '@/utils/youtube';

/** What the player needs to know about a video */
export type PlayableVideo = Pick<Video, 'id' | 'title'>;

const EMBED_ORIGIN = 'https://www.youtube.com';

// Extension pages send no Referer, and YouTube refuses to play embeds without
// one (error 153) or with its own domain as one (error 152). Identify the
// embedder as this project, for embed requests made by this extension only.
const refererRule = browser.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [
    {
      id: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Referer', operation: 'set', value: 'https://github.com/buntec/yt3k' },
        ],
      },
      condition: {
        urlFilter: '|https://www.youtube.com/embed/',
        resourceTypes: ['sub_frame'],
        initiatorDomains: [extensionHost()],
      },
    },
  ],
}).catch((err) => {
  // The embed then fails with error 153 and the video opens on YouTube.
  console.error('Could not set the embed Referer', err);
});

type OpenPlayer = (video: PlayableVideo) => void;

const PlayerContext = createContext<OpenPlayer>(() => {
  throw new Error('usePlayer() needs a <PlayerProvider>');
});

/** Plays a video here, or in a new YouTube tab if it can't be embedded. */
export function usePlayer(): OpenPlayer {
  return use(PlayerContext);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ video: PlayableVideo; src: string }>();
  const frameRef = useRef<HTMLIFrameElement>(null);

  const openPlayer = useCallback(async (video: PlayableVideo) => {
    await refererRule;
    const params = new URLSearchParams({
      autoplay: '1',
      rel: '0',
      // Lets the player report errors to this page via postMessage.
      enablejsapi: '1',
      origin: location.origin,
    });
    setCurrent({ video, src: `${EMBED_ORIGIN}/embed/${video.id}?${params}` });
  }, []);

  useEffect(() => {
    if (!current) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== EMBED_ORIGIN || event.source !== frameRef.current?.contentWindow) {
        return;
      }
      let data: { event?: string; info?: unknown };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      // E.g. errors 101/150 (embedding disabled by the uploader): the video only
      // plays on YouTube itself.
      if (data.event === 'onError') {
        console.warn(`Embedded player error ${data.info}, opening on YouTube`);
        setCurrent(undefined);
        void openTabNextToThisOne(watchUrl(current.video));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [current]);

  // Subscribe to the player's events once it has loaded.
  const onFrameLoad = () => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      EMBED_ORIGIN,
    );
  };

  return (
    <PlayerContext value={openPlayer}>
      {children}
      <Dialog
        isOpen={current !== undefined}
        onOpenChange={(isOpen) => !isOpen && setCurrent(undefined)}
        // Keep the whole 16:9 video plus title bar inside the viewport.
        width="min(1200px, 100vw - 48px, (100dvh - 120px) * 16 / 9)"
        maxHeight="none"
      >
        {current && (
          <>
            <DialogHeader
              title={current.video.title}
              endContent={
                <Button
                  label="Watch on YouTube"
                  variant="ghost"
                  size="sm"
                  href={watchUrl(current.video)}
                />
              }
              onOpenChange={() => setCurrent(undefined)}
            />
            <iframe
              ref={frameRef}
              className="player-frame"
              src={current.src}
              title="YouTube video player"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              onLoad={onFrameLoad}
            />
          </>
        )}
      </Dialog>
    </PlayerContext>
  );
}

/**
 * A link to the video on YouTube. Plain clicks play it in the embedded player;
 * modified clicks (new tab etc.) follow the link to YouTube as usual.
 */
export function PlayableLink({
  video,
  ...props
}: { video: PlayableVideo } & Omit<React.ComponentProps<'a'>, 'href' | 'onClick'>) {
  const openPlayer = usePlayer();
  return (
    <a
      {...props}
      href={watchUrl(video)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        openPlayer(video);
      }}
    />
  );
}

export function watchUrl(video: PlayableVideo) {
  return `https://www.youtube.com/watch?v=${video.id}`;
}

/** Opens a tab right after this page's tab, keeping this page open. */
async function openTabNextToThisOne(url: string) {
  const tab = await browser.tabs.getCurrent();
  await browser.tabs.create({
    url,
    index: tab ? tab.index + 1 : undefined,
    openerTabId: tab?.id,
  });
}
