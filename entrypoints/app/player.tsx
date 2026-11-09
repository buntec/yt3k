import { createContext, use, useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, PictureInPicture2 } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { DialogHeader } from '@astryxdesign/core/Dialog';
import { useScrollLock } from '@astryxdesign/core/hooks';
import { Icon } from '@astryxdesign/core/Icon';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { extensionHost } from '@/utils/extension';
import type { Video } from '@/utils/youtube';
import { useAutoplay } from './autoplay';
import { getProgress, savePosition } from './podcasts/progress';
import { SPEEDS, type Speed, setSpeed, useSpeed } from './podcasts/speed';

/** What the player needs to know about a video */
export type PlayableVideo = Pick<Video, 'id' | 'title' | 'duration' | 'progress'>;

/** What the player needs to know about a podcast episode */
export interface PlayableEpisode {
  /** Its progress is kept under it, as made by episodeKey */
  key: string;
  title: string;
  showTitle: string;
  mediaUrl: string;
  mediaType?: string;
  /** Length in seconds, as the feed tells it */
  duration?: number;
  image?: string;
  /** The episode's web page */
  link?: string;
}

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

type PlayEpisode = (episode: PlayableEpisode) => void;

type Playing =
  | { kind: 'video'; video: PlayableVideo; src: string; onClose?: () => void }
  /** `start` is where the user left off, in seconds */
  | { kind: 'episode'; episode: PlayableEpisode; start: number; onClose?: undefined };

const PlayerContext = createContext<OpenPlayer>(() => {
  throw new Error('usePlayer() needs a <PlayerProvider>');
});

const EpisodePlayerContext = createContext<PlayEpisode>(() => {
  throw new Error('usePlayEpisode() needs a <PlayerProvider>');
});

/** Plays a video here, or in a new YouTube tab if it can't be embedded. */
export function usePlayer(): OpenPlayer {
  return use(PlayerContext);
}

/** Plays a podcast episode here, from where the user left off. */
export function usePlayEpisode(): PlayEpisode {
  return use(EpisodePlayerContext);
}

/** Whether `playing` is that video or episode */
function isPlaying(playing: Playing | undefined, id: string) {
  if (!playing) return false;
  return (playing.kind === 'video' ? playing.video.id : playing.episode.key) === id;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const autoplay = useAutoplay();
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
    // The video is already playing, minimized: bring it back without restarting it.
    if (isPlaying(currentRef.current, video.id)) {
      setIsMinimized(false);
      return;
    }
    // Another video replaces the one playing at the same size, so a minimized
    // player stays out of the way.
    if (!currentRef.current) setIsMinimized(false);
    await refererRule;
    const params = new URLSearchParams({
      // Off unless chosen: YouTube leaves videos that start without a click in
      // the player out of the watch history, also when started via the JS API.
      autoplay: autoplay ? '1' : '0',
      rel: '0',
      // Lets the player report errors to this page via postMessage.
      enablejsapi: '1',
      origin: location.origin,
    });
    // Embeds always start from the beginning, so pick up where the user left off.
    const start = resumePosition(video);
    if (start) params.set('start', String(start));
    play({ kind: 'video', video, src: `${EMBED_ORIGIN}/embed/${video.id}?${params}`, onClose });
  }, [play, autoplay]);

  const playEpisode = useCallback<PlayEpisode>(async (episode) => {
    if (isPlaying(currentRef.current, episode.key)) {
      setIsMinimized(false);
      return;
    }
    if (!currentRef.current) setIsMinimized(false);
    const progress = await getProgress(episode.key);
    play({ kind: 'episode', episode, start: progress?.isPlayed ? 0 : (progress?.position ?? 0) });
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
    if (current?.kind !== 'video') return;
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

  const title = current?.kind === 'video' ? current.video.title : current?.episode.title;
  const isAudio = current?.kind === 'episode' && !current.episode.mediaType?.startsWith('video/');

  return (
    <PlayerContext value={openPlayer}>
      <EpisodePlayerContext value={playEpisode}>
        {children}
        <VStack
          as="dialog"
          ref={dialogRef}
          className={isAudio ? 'player is-audio' : 'player'}
          aria-label={title}
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
                title={title}
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
                      {current.kind === 'video' ? (
                        <Button
                          label="Watch on YouTube"
                          variant="ghost"
                          size="sm"
                          href={watchUrl(current.video)}
                        />
                      ) : (
                        <>
                          <SpeedSelector />
                          {current.episode.link && (
                            <Button
                              label="Episode page"
                              variant="ghost"
                              size="sm"
                              href={current.episode.link}
                              target="_blank"
                            />
                          )}
                        </>
                      )}
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
              {current.kind === 'video' ? (
                <iframe
                  ref={frameRef}
                  className="player-frame"
                  src={current.src}
                  title="YouTube video player"
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  onLoad={onFrameLoad}
                />
              ) : (
                <EpisodeMedia
                  // A new element for each episode, so one's position isn't saved for another
                  key={current.episode.key}
                  episode={current.episode}
                  start={current.start}
                  isAudio={isAudio}
                />
              )}
            </>
          )}
        </VStack>
      </EpisodePlayerContext>
    </PlayerContext>
  );
}

/** How often the position is saved while playing, in ms */
const SAVE_INTERVAL = 5000;

/**
 * The episode's audio, or video, with the browser's own controls, starting
 * where the user left off and keeping where they are as it plays.
 */
function EpisodeMedia({
  episode,
  start,
  isAudio,
}: {
  episode: PlayableEpisode;
  start: number;
  isAudio: boolean;
}) {
  const mediaRef = useRef<HTMLMediaElement>(null);
  const speed = useSpeed();

  useEffect(() => {
    const media = mediaRef.current!;
    // The default too, which loading the media resets the speed to
    media.defaultPlaybackRate = speed;
    media.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const media = mediaRef.current!;
    let savedAt = 0;
    const save = () => {
      if (media.currentTime === 0) return;
      savedAt = Date.now();
      const duration = Number.isFinite(media.duration) ? media.duration : episode.duration;
      void savePosition(episode.key, media.currentTime, duration);
    };
    const onTimeUpdate = () => {
      if (Date.now() - savedAt >= SAVE_INTERVAL) save();
    };
    const onLoadedMetadata = () => {
      if (start > 0) media.currentTime = start;
    };
    media.addEventListener('loadedmetadata', onLoadedMetadata);
    media.addEventListener('timeupdate', onTimeUpdate);
    // Ending pauses it too, saving it as played
    media.addEventListener('pause', save);
    return () => {
      save();
      media.removeEventListener('loadedmetadata', onLoadedMetadata);
      media.removeEventListener('timeupdate', onTimeUpdate);
      media.removeEventListener('pause', save);
    };
  }, [episode, start]);

  useMediaSession(mediaRef, episode);

  // Clicked to play, so it starts on its own, unlike YouTube's videos: no
  // watch history to keep it out of.
  const props = {
    src: episode.mediaUrl,
    controls: true,
    autoPlay: true,
    preload: 'auto',
    onRateChange: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      // The browser's own speed menu, where it has one
      const rate = event.currentTarget.playbackRate;
      if (SPEEDS.includes(rate as Speed)) setSpeed(rate as Speed);
    },
  };

  if (!isAudio) {
    return (
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        className="player-frame"
        {...props}
      />
    );
  }
  return (
    <HStack gap={4} vAlign="center">
      {episode.image && <img className="episode-art" src={episode.image} alt="" />}
      <StackItem size="fill">
        <VStack gap={2}>
          <Text type="supporting">{episode.showTitle}</Text>
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            className="player-audio"
            {...props}
          />
        </VStack>
      </StackItem>
    </HStack>
  );
}

/** Seconds the skip back and forward keys of headphones and keyboards skip by default */
const SKIP_BACK = 15;
const SKIP_FORWARD = 30;

/**
 * Tells the system what's playing, so the media keys of keyboards and
 * headphones work, and its own media controls show the episode, with its
 * artwork, and where it is. YouTube's player does the same for videos.
 */
function useMediaSession(
  mediaRef: React.RefObject<HTMLMediaElement | null>,
  episode: PlayableEpisode,
) {
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const media = mediaRef.current!;
    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.showTitle,
      artwork: episode.image ? [{ src: episode.image }] : [],
    });

    const seekTo = (seconds: number) => {
      const end = Number.isFinite(media.duration) ? media.duration : Infinity;
      media.currentTime = Math.max(0, Math.min(seconds, end));
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void media.play()],
      ['pause', () => media.pause()],
      ['stop', () => media.pause()],
      ['seekbackward', ({ seekOffset }) => seekTo(media.currentTime - (seekOffset ?? SKIP_BACK))],
      ['seekforward', ({ seekOffset }) => seekTo(media.currentTime + (seekOffset ?? SKIP_FORWARD))],
      ['seekto', ({ seekTime }) => seekTime !== undefined && seekTo(seekTime)],
    ];
    for (const [action, handler] of handlers) setActionHandler(session, action, handler);

    const showPosition = () => {
      if (!Number.isFinite(media.duration)) return;
      try {
        session.setPositionState({
          duration: media.duration,
          playbackRate: media.playbackRate,
          position: Math.min(media.currentTime, media.duration),
        });
      } catch (err) {
        console.warn(err);
      }
    };
    const onPlaying = () => {
      session.playbackState = 'playing';
      showPosition();
    };
    const onPause = () => {
      session.playbackState = 'paused';
      showPosition();
    };
    // The system moves the position on as it plays; it needs telling of jumps.
    const events = ['loadedmetadata', 'seeked', 'ratechange'] as const;
    for (const event of events) media.addEventListener(event, showPosition);
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', onPause);
    return () => {
      for (const event of events) media.removeEventListener(event, showPosition);
      media.removeEventListener('playing', onPlaying);
      media.removeEventListener('pause', onPause);
      for (const [action] of handlers) setActionHandler(session, action, null);
      session.metadata = null;
      session.playbackState = 'none';
    };
  }, [mediaRef, episode]);
}

/** Sets the handler, unless the browser doesn't know the action, which throws */
function setActionHandler(
  session: MediaSession,
  action: MediaSessionAction,
  handler: MediaSessionActionHandler | null,
) {
  try {
    session.setActionHandler(action, handler);
  } catch {}
}

/** The playback speed of episodes, which every episode keeps */
function SpeedSelector() {
  const speed = useSpeed();
  return (
    <Selector
      label="Playback speed"
      isLabelHidden
      variant="secondary"
      size="sm"
      options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
      value={String(speed)}
      onChange={(value) => setSpeed(Number(value) as Speed)}
    />
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
