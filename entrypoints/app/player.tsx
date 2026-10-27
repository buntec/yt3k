import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, PictureInPicture2 } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { DialogHeader } from '@astryxdesign/core/Dialog';
import { useScrollLock } from '@astryxdesign/core/hooks';
import { Icon } from '@astryxdesign/core/Icon';
import { VStack } from '@astryxdesign/core/VStack';
import { extensionHost } from '@/utils/extension';
import type { Video } from '@/utils/youtube';

/** What the player needs to know about a video */
export type PlayableVideo = Pick<Video, 'id' | 'title' | 'duration' | 'progress'>;

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

type OpenPlayer = (video: PlayableVideo, options?: { onClose?: () => void }) => void;

type Playing = { video: PlayableVideo; src: string; onClose?: () => void };

const PlayerContext = createContext<OpenPlayer>(() => {
  throw new Error('usePlayer() needs a <PlayerProvider>');
});

/** Plays a video here, or in a new YouTube tab if it can't be embedded. */
export function usePlayer(): OpenPlayer {
  return use(PlayerContext);
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<Playing>();
  // Minimized, the player sits in the bottom right corner and leaves the page usable.
  const [isMinimized, setIsMinimized] = useState(false);
  // What is playing, for openPlayer() to read without changing on every video.
  const currentRef = useRef<Playing>(undefined);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const play = useCallback((next: Playing | undefined) => {
    currentRef.current?.onClose?.();
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const openPlayer = useCallback<OpenPlayer>(async (video, { onClose } = {}) => {
    setIsMinimized(false);
    // The video is already playing, minimized: bring it back without restarting it.
    if (currentRef.current?.video.id === video.id) return;
    await refererRule;
    // No autoplay: YouTube leaves videos that start without a click in the
    // player out of the watch history, also when started via the JS API.
    const params = new URLSearchParams({
      rel: '0',
      // Lets the player report errors to this page via postMessage.
      enablejsapi: '1',
      origin: location.origin,
    });
    // Embeds always start from the beginning, so pick up where the user left off.
    const start = resumePosition(video);
    if (start) params.set('start', String(start));
    play({ video, src: `${EMBED_ORIGIN}/embed/${video.id}?${params}`, onClose });
  }, [play]);

  const closePlayer = () => play(undefined);

  // One <dialog> for both sizes, shown modal or not: an iframe moved to another
  // element reloads, and the video would start over.
  useEffect(() => {
    const dialog = dialogRef.current!;
    if (!current) {
      dialog.close();
      return;
    }
    const isModal = !isMinimized;
    if (dialog.open && dialog.matches(':modal') === isModal) return;
    dialog.close();
    if (isModal) dialog.showModal();
    else dialog.show();
  }, [current, isMinimized]);

  // Escape makes the browser close the full-size player. Switching sizes
  // closes it too, but it is open again by the time the event fires.
  useEffect(() => {
    const dialog = dialogRef.current!;
    const onClose = () => {
      if (!dialog.open) play(undefined);
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [play]);

  useScrollLock(current !== undefined && !isMinimized);

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
        closePlayer();
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
      <VStack
        as="dialog"
        ref={dialogRef}
        className="player"
        aria-label={current?.video.title}
        padding={isMinimized ? 2 : 4}
        gap={isMinimized ? 2 : 3}
        // A click on the backdrop lands on the dialog, outside its box.
        onClick={(event) => {
          if (isMinimized || event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          const { clientX: x, clientY: y } = event;
          if (x < box.left || x > box.right || y < box.top || y > box.bottom) closePlayer();
        }}
      >
        {current && (
          <>
            <DialogHeader
              title={current.video.title}
              endContent={
                isMinimized ? (
                  <Button
                    label="Expand player"
                    tooltip="Expand player"
                    isIconOnly
                    icon={<Icon icon={Maximize2} />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsMinimized(false)}
                  />
                ) : (
                  <>
                    <Button
                      label="Watch on YouTube"
                      variant="ghost"
                      size="sm"
                      href={watchUrl(current.video)}
                    />
                    <Button
                      label="Minimize player"
                      tooltip="Minimize player"
                      isIconOnly
                      icon={<Icon icon={PictureInPicture2} />}
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsMinimized(true)}
                    />
                  </>
                )
              }
              onOpenChange={closePlayer}
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
      </VStack>
    </PlayerContext>
  );
}

/**
 * A link to the video on YouTube. Plain clicks play it in the embedded player;
 * modified clicks (new tab etc.) follow the link to YouTube as usual.
 */
export function PlayableLink({
  video,
  onPlayerClose,
  ...props
}: {
  video: PlayableVideo;
  /** Called when the embedded player this link opened is closed */
  onPlayerClose?: () => void;
} & Omit<React.ComponentProps<'a'>, 'href' | 'onClick'>) {
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
        openPlayer(video, { onClose: onPlayerClose });
      }}
    />
  );
}

/**
 * Seconds into the video where the user stopped watching it, if they started
 * and didn't (nearly) finish it. As precise as the whole percent YouTube tells.
 */
function resumePosition({ duration, progress }: PlayableVideo): number | undefined {
  const seconds = duration && parseDuration(duration);
  if (!seconds || !progress || progress >= 95) return undefined;
  return Math.floor((seconds * progress) / 100);
}

/** Seconds in a duration badge like "21:52" or "1:02:03"; undefined for e.g. "LIVE" */
function parseDuration(text: string): number | undefined {
  if (!/^\d+(:\d\d){1,2}$/.test(text)) return undefined;
  return text.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
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
