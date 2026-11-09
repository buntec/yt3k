import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Copy,
  Download,
  EllipsisVertical,
  ExternalLink,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent, LayoutFooter, LayoutHeader } from '@astryxdesign/core/Layout';
import { List, ListItem } from '@astryxdesign/core/List';
import { MoreMenu } from '@astryxdesign/core/MoreMenu';
import { Overlay } from '@astryxdesign/core/Overlay';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { type Episode, normalizeFeedUrl } from '@/utils/podcast';
import { type DirectoryPodcast, applePodcastId, isAddress } from '@/utils/podcastDirectory';
import { useArtwork } from '../artwork';
import { type PlayableEpisode, usePlayEpisode } from '../player';
import { foldForSearch, useSearchShortcut } from '../search';
import {
  DriveSyncButton,
  DriveSyncDialog,
  isDriveSyncOffered,
} from '../subscriptions/DriveSyncDialog';
import { type Progress, episodeKey, setPlayed, useProgress } from './progress';
import { type Show, useShows } from './shows';
import {
  type Feeds,
  type ImportResult,
  allowReadingFeeds,
  exportPodcasts,
  followPodcast,
  importPodcasts,
  refollowPodcast,
  refreshFeeds,
  searchPodcasts,
  undoImport,
  unfollowPodcast,
  usePodcasts,
} from './store';

/** How many episodes show at first, and how many more each Show more adds */
const PAGE_SIZE = 50;
/** How often to look for new episodes while the page is shown */
const REFRESH_INTERVAL = 5 * 60 * 1000;

/** Which shows' episodes the page lists: all, or one show's, by its feed URL */
type ShowFilter = 'all' | (string & {});

const FILTER_KEY = 'podcastFilter';

/** An episode as the page lists it, with its show */
interface ListedEpisode {
  episode: Episode;
  key: string;
  show: Show;
  showTitle: string;
  /** Artwork to show, best first: the episode's, else the show's */
  images: string[];
}

/** The newest episodes of the podcasts followed, from their RSS feeds */
export function PodcastsPage() {
  const { shows, isLoaded } = useShows();
  const { feeds, needsAccess, movesNeedAccess, errors, isRefreshing, status } = usePodcasts();
  const waiting = needsAccess.length + Object.keys(movesNeedAccess).length;
  const progress = useProgress();
  const [storedFilter, setStoredFilter] = useState<ShowFilter>(readFilter);
  // A show unfollowed meanwhile, e.g. in another browser, leaves all shown
  const filter = shows.some((s) => s.feedUrl === storedFilter) ? storedFilter : 'all';
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  const chooseFilter = (value: ShowFilter) => {
    setStoredFilter(value);
    setLimit(PAGE_SIZE);
    try {
      if (value === 'all') localStorage.removeItem(FILTER_KEY);
      else localStorage.setItem(FILTER_KEY, value);
    } catch (err) {
      console.warn(err);
    }
  };

  // Shows followed in another browser arrive through sync: load their feeds.
  useEffect(() => {
    if (isLoaded) void refreshFeeds(false);
  }, [isLoaded, shows]);

  // Looks for new episodes now and then while the page is shown, and on
  // coming back to it; feeds loaded recently aren't loaded again.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshFeeds(false);
    };
    const timer = setInterval(refreshIfVisible, REFRESH_INTERVAL);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, []);

  const episodes = useMemo(() => listEpisodes(shows, feeds, filter), [shows, feeds, filter]);
  const matching = deferredQuery
    ? episodes.filter((e) =>
        [e.episode.title, e.showTitle].some((text) => foldForSearch(text).includes(deferredQuery)),
      )
    : episodes;
  const failed = Object.keys(errors).length > 0;

  return (
    <Layout
      start={
        <PodcastsNav
          shows={shows}
          feeds={feeds}
          errors={errors}
          filter={filter}
          onFilterChange={chooseFilter}
        />
      }
      header={
        <LayoutHeader hasDivider padding={6}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={1}>Podcasts</Heading>
            <TextInput
              ref={searchRef}
              label="Search episodes and podcasts"
              isLabelHidden
              placeholder="Search episodes and podcasts"
              value={query}
              onChange={setQuery}
              hasClear
              autoComplete="off"
              width={280}
            />
            <StackItem size="fill">
              <span className={failed ? 'status error' : 'status'} role="status">
                <Text type="supporting" color="inherit">
                  {status}
                </Text>
              </span>
            </StackItem>
            <Button
              label="Refresh"
              isLoading={isRefreshing}
              isDisabled={shows.length === 0}
              onClick={() => void refreshFeeds(true)}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={6} maxWidth={1000}>
            {waiting > 0 && (
              <Banner
                status="warning"
                title={
                  waiting === 1
                    ? 'A podcast needs your permission'
                    : `${waiting} podcasts need your permission`
                }
                description="Imported, followed in another browser, or moved to a new address, they need your permission for yt3k to read their feeds here."
                endContent={<Button label="Allow" size="sm" clickAction={allowReadingFeeds} />}
              />
            )}
            {!isLoaded ? null : shows.length === 0 ? (
              <EmptyState
                title="No podcasts yet"
                description="Search for podcasts by name, or follow one by the address of its RSS feed."
                headingLevel={2}
                actions={<AddPodcastButton variant="primary" />}
              />
            ) : matching.length === 0 ? (
              !isRefreshing && (
                <EmptyState
                  title={deferredQuery ? 'No matching episodes' : 'No episodes yet'}
                  headingLevel={2}
                  isCompact
                />
              )
            ) : (
              <>
                <List hasDividers density="spacious">
                  {matching.slice(0, limit).map((item) => (
                    <EpisodeRow key={item.key} item={item} progress={progress[item.key]} />
                  ))}
                </List>
                {matching.length > limit && (
                  <Center>
                    <Button label="Show more" onClick={() => setLimit(limit + PAGE_SIZE)} />
                  </Center>
                )}
              </>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

/** The episodes of the shows the filter passes, newest first */
function listEpisodes(shows: Show[], feeds: Feeds, filter: ShowFilter): ListedEpisode[] {
  return shows
    .filter((show) => filter === 'all' || show.feedUrl === filter)
    .flatMap((show) => {
      const feed = feeds[show.feedUrl]?.feed;
      if (!feed) return [];
      return feed.episodes.map((episode) => ({
        episode,
        key: episodeKey(show.feedUrl, episode.id),
        show,
        showTitle: feed.title,
        images: [
          ...new Set([episode.image, feed.image, show.image].filter((i) => i !== undefined)),
        ],
      }));
    })
    .sort((a, b) => (b.episode.published ?? '').localeCompare(a.episode.published ?? ''));
}

// Memoized so progress saved while one episode plays doesn't re-render the others.
const EpisodeRow = memo(function EpisodeRow({
  item,
  progress,
}: {
  item: ListedEpisode;
  progress?: Progress;
}) {
  const playEpisode = usePlayEpisode();
  const { episode, key, showTitle, images } = item;
  const [image, onImageError] = useArtwork(images);
  const duration = progress?.duration ?? episode.duration;
  const position = progress?.isPlayed ? 0 : (progress?.position ?? 0);
  const details = [
    showTitle,
    episode.published && formatDate(episode.published),
    progress?.isPlayed
      ? 'Played'
      : duration && position > 0
        ? `${formatDuration(duration - position)} left`
        : duration && formatDuration(duration),
  ].filter(Boolean);

  const play = () => {
    const playable: PlayableEpisode = {
      key,
      title: episode.title,
      showTitle,
      mediaUrl: episode.mediaUrl,
      mediaType: episode.mediaType,
      duration: episode.duration,
      images,
      link: episode.link,
    };
    playEpisode(playable);
  };

  // On the artwork, by the title, shown on hover or focus; in its place without one
  const playButton = (
    <IconButton
      label={position > 0 ? `Resume ${episode.title}` : `Play ${episode.title}`}
      tooltip={position > 0 ? 'Resume' : 'Play'}
      icon={<Icon icon={Play} />}
      onClick={play}
    />
  );

  return (
    <ListItem
      label={
        <Text weight="medium" maxLines={2} color={progress?.isPlayed ? 'secondary' : undefined}>
          {episode.title}
        </Text>
      }
      description={
        <VStack gap={2}>
          <Text type="supporting">{details.join(' · ')}</Text>
          {duration && position > 0 ? (
            <ProgressBar
              label="Listened"
              isLabelHidden
              value={Math.min(position, duration)}
              max={duration}
            />
          ) : null}
        </VStack>
      }
      startContent={
        image ? (
          <Overlay showOn="hover" align="center" content={playButton}>
            <img
              className="episode-thumbnail"
              src={image}
              alt=""
              loading="lazy"
              onError={onImageError}
            />
          </Overlay>
        ) : (
          playButton
        )
      }
      endContent={
        <DropdownMenu
          button={{
            label: 'More actions',
            isIconOnly: true,
            icon: <Icon icon={EllipsisVertical} />,
            variant: 'ghost',
            size: 'sm',
          }}
          hasChevron={false}
          alignment="end"
          items={[
            progress?.isPlayed || position > 0
              ? {
                  label: 'Mark as not played',
                  icon: RotateCcw,
                  onClick: () => void setPlayed(key, false),
                }
              : { label: 'Mark as played', icon: Check, onClick: () => void setPlayed(key, true) },
            ...(episode.link
              ? [{ label: 'Episode page', icon: ExternalLink, onClick: () => openTab(episode.link!) }]
              : []),
          ]}
        />
      }
      align="start"
    />
  );
});

/** The page's sidebar: all podcasts, and each to list its episodes alone. */
function PodcastsNav({
  shows,
  feeds,
  errors,
  filter,
  onFilterChange,
}: {
  shows: Show[];
  feeds: Feeds;
  errors: Partial<Record<string, string>>;
  filter: ShowFilter;
  onFilterChange: (filter: ShowFilter) => void;
}) {
  const showToast = useToast();
  const [isSyncOpen, setIsSyncOpen] = useState(false);

  const unfollow = async (show: Show, title: string) => {
    if (filter === show.feedUrl) onFilterChange('all');
    try {
      await unfollowPodcast(show.feedUrl);
    } catch (err) {
      console.warn(err);
      showToast({ type: 'error', body: `Couldn't unfollow ${title}` });
      return;
    }
    const hide = showToast({
      body: `Unfollowed ${title}`,
      uniqueID: `unfollow-${show.feedUrl}`,
      autoHideDuration: 10_000,
      endContent: (
        <Button
          label="Undo"
          size="sm"
          variant="ghost"
          onClick={() => {
            hide();
            void refollowPodcast(show);
          }}
        />
      ),
    });
  };

  const download = async () => {
    const url = URL.createObjectURL(new Blob([await exportPodcasts()], { type: 'text/x-opml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `yt3k-podcasts-${new Date().toISOString().slice(0, 10)}.opml`;
    link.click();
    // Firefox may not have started the download when click returns
    setTimeout(() => URL.revokeObjectURL(url));
  };

  const upload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.opml,.xml,text/x-opml,text/xml,application/xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      let result: ImportResult;
      try {
        result = await importPodcasts(await file.text());
      } catch (err) {
        console.warn(err);
        showToast({ type: 'error', body: `${file.name} isn't an OPML file` });
        return;
      }
      const { added, alreadyFollowed } = result;
      if (added.length === 0) {
        showToast({
          body: alreadyFollowed
            ? `You follow every podcast in ${file.name} already`
            : `${file.name} lists no podcasts`,
        });
        return;
      }
      const count = `${added.length} ${added.length === 1 ? 'podcast' : 'podcasts'}`;
      const hide = showToast({
        body:
          `Following ${count} from ${file.name}` +
          (alreadyFollowed ? ` · ${alreadyFollowed} followed already` : ''),
        uniqueID: 'podcast-import',
        // Long enough to reach for Undo
        autoHideDuration: 10_000,
        endContent: (
          <Button
            label="Undo"
            size="sm"
            variant="ghost"
            onClick={() => {
              hide();
              void undoImport(result);
            }}
          />
        ),
      });
    };
    input.click();
  };

  const copyFeedUrl = async (show: Show) => {
    try {
      await navigator.clipboard.writeText(show.feedUrl);
      showToast({ body: 'Copied the feed address' });
    } catch (err) {
      console.warn(err);
      showToast({ type: 'error', body: "Couldn't copy the feed address" });
    }
  };

  return (
    <>
      <SideNav>
        <SideNavItem
          label="All podcasts"
          isSelected={filter === 'all'}
          onClick={() => onFilterChange('all')}
          endContent={<Badge label={shows.length} />}
        />
        <SideNavSection
          title="Podcasts"
          endContent={
            <HStack gap={1} vAlign="center">
              <DriveSyncButton onClick={() => setIsSyncOpen(true)} />
              <MoreMenu
                label="Podcast options"
                size="sm"
                alignment="end"
                items={[
                  {
                    label: 'Export as OPML',
                    icon: Download,
                    description: 'For other podcast apps, or as a backup',
                    isDisabled: shows.length === 0,
                    onClick: () => void download(),
                  },
                  {
                    label: 'Import OPML…',
                    icon: Upload,
                    description: 'Follows the podcasts exported from another app',
                    onClick: upload,
                  },
                  ...(isDriveSyncOffered
                    ? [
                        {
                          label: 'Sync with Google Drive…',
                          icon: Cloud,
                          description: 'Keeps podcasts the same in all your browsers',
                          onClick: () => setIsSyncOpen(true),
                        },
                      ]
                    : []),
                ]}
              />
              <AddPodcastButton variant="ghost" />
            </HStack>
          }
        >
          {shows.map((show) => {
            const feed = feeds[show.feedUrl]?.feed;
            const title = feed?.title ?? show.title;
            const error = errors[show.feedUrl];
            return (
              <SideNavItem
                key={show.feedUrl}
                label={title}
                isSelected={filter === show.feedUrl}
                onClick={() => onFilterChange(show.feedUrl)}
                endContent={
                  error && (
                    <span data-tooltip={error}>
                      <Icon icon={TriangleAlert} size="sm" color="error" />
                    </span>
                  )
                }
                actions={
                  <MoreMenu
                    label={`${title} options`}
                    alignment="end"
                    items={[
                      ...(feed?.link
                        ? [{ label: 'Website', icon: ExternalLink, onClick: () => openTab(feed.link!) }]
                        : []),
                      { label: 'Copy feed address', icon: Copy, onClick: () => void copyFeedUrl(show) },
                      {
                        label: 'Unfollow',
                        icon: Trash2,
                        variant: 'destructive',
                        onClick: () => void unfollow(show, title),
                      },
                    ]}
                  />
                }
              />
            );
          })}
          {shows.length === 0 && (
            <Text type="supporting">Follow podcasts with the Add podcast button.</Text>
          )}
        </SideNavSection>
      </SideNav>
      {isSyncOpen && <DriveSyncDialog onClose={() => setIsSyncOpen(false)} />}
    </>
  );
}

function AddPodcastButton({ variant }: { variant: 'primary' | 'ghost' }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      {variant === 'ghost' ? (
        <IconButton
          label="Add podcast"
          tooltip="Add podcast"
          icon={<Icon icon={Plus} />}
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(true)}
        />
      ) : (
        <Button label="Add podcast" variant="primary" onClick={() => setIsOpen(true)} />
      )}
      {isOpen && <AddPodcastDialog onClose={() => setIsOpen(false)} />}
    </>
  );
}

function AddPodcastDialog({ onClose }: { onClose: () => void }) {
  const showToast = useToast();
  const { shows } = useShows();
  const [input, setInput] = useState('');
  const [problem, setProblem] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  /** What the last search found */
  const [results, setResults] = useState<{ term: string; podcasts: DirectoryPodcast[] }>();
  /** The feed of the podcast found that is being followed */
  const [following, setFollowing] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const followed = new Set(shows.map((s) => s.feedUrl));
  // A feed's address is followed right away; words, or an Apple Podcasts
  // link, are looked up in Apple's directory.
  const addsByAddress = isAddress(input) && !applePodcastId(input);

  // The dialog focuses its title, which hasAutoFocus doesn't win over; this
  // runs after it, the dialog's effects running before its parent's.
  useEffect(() => inputRef.current?.focus(), []);

  // Right in the click or Enter handler: the browser asks for permissions,
  // to search the directory or read a feed's site, only while handling one.
  const submit = () => {
    const text = input.trim();
    if (isBusy) return;
    if (!text) return setProblem("Enter a podcast's name, or the address of its RSS feed");
    setProblem(undefined);
    setIsBusy(true);
    const fail = (err: unknown) => {
      console.warn(err);
      setIsBusy(false);
      setProblem(errorMessage(err));
    };
    if (addsByAddress) {
      followPodcast(text).then((show) => {
        showToast({ body: `Following ${show.title}` });
        onClose();
      }, fail);
    } else {
      searchPodcasts(text).then((podcasts) => {
        setIsBusy(false);
        setResults({ term: text, podcasts });
      }, fail);
    }
  };

  const follow = (podcast: DirectoryPodcast) => {
    if (following) return;
    setFollowing(podcast.feedUrl);
    followPodcast(podcast.feedUrl).then(
      (show) => {
        setFollowing(undefined);
        showToast({ body: `Following ${show.title}` });
      },
      (err: unknown) => {
        console.warn(err);
        setFollowing(undefined);
        showToast({ type: 'error', body: `Couldn't follow ${podcast.title}: ${errorMessage(err)}` });
      },
    );
  };

  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} purpose="form" width={560}>
      <Layout
        header={<DialogHeader title="Add podcast" onOpenChange={onClose} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <VStack gap={2}>
                <TextInput
                  ref={inputRef}
                  label="Podcast name or feed address"
                  placeholder="Search podcasts, or paste an RSS feed address"
                  value={input}
                  onChange={(value) => {
                    setInput(value);
                    setProblem(undefined);
                  }}
                  onEnter={submit}
                  status={problem ? { type: 'error', message: problem } : undefined}
                  autoComplete="off"
                />
                <Text type="supporting" as="p">
                  Searches Apple's podcast directory, which your browser asks to allow the first
                  time. Following a podcast asks to let yt3k read feeds from its site.
                </Text>
              </VStack>
              {results &&
                (results.podcasts.length === 0 ? (
                  <EmptyState
                    title={`No podcasts found for “${results.term}”`}
                    description="Only podcasts with a public RSS feed can be followed here."
                    headingLevel={2}
                    isCompact
                  />
                ) : (
                  <List hasDividers edge="flush">
                    {results.podcasts.map((podcast) => (
                      <FoundPodcast
                        key={podcast.feedUrl}
                        podcast={podcast}
                        isFollowed={followed.has(feedKey(podcast.feedUrl))}
                        isFollowing={following === podcast.feedUrl}
                        onFollow={() => follow(podcast)}
                      />
                    ))}
                  </List>
                ))}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label={results ? 'Done' : 'Cancel'} variant="secondary" onClick={onClose} />
              <Button
                label={addsByAddress ? 'Add' : 'Search'}
                variant="primary"
                isLoading={isBusy}
                onClick={submit}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

/** A podcast a search found, to follow */
function FoundPodcast({
  podcast,
  isFollowed,
  isFollowing,
  onFollow,
}: {
  podcast: DirectoryPodcast;
  isFollowed: boolean;
  isFollowing: boolean;
  onFollow: () => void;
}) {
  const { episodeCount } = podcast;
  const details = [
    podcast.author,
    episodeCount && `${episodeCount} ${episodeCount === 1 ? 'episode' : 'episodes'}`,
  ];
  return (
    <ListItem
      label={podcast.title}
      description={details.filter(Boolean).join(' · ')}
      startContent={
        podcast.image ? (
          <img className="search-thumbnail" src={podcast.image} alt="" loading="lazy" />
        ) : undefined
      }
      endContent={
        isFollowed ? (
          <Button label="Following" size="sm" variant="ghost" isDisabled />
        ) : (
          // Right in the click handler, like Add: following asks for a permission.
          <Button label="Follow" size="sm" isLoading={isFollowing} onClick={onFollow} />
        )
      }
    />
  );
}

/** A feed's address as the shows followed have it, to tell whether one is */
function feedKey(feedUrl: string): string {
  try {
    return normalizeFeedUrl(feedUrl);
  } catch {
    return feedUrl;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readFilter(): ShowFilter {
  try {
    return localStorage.getItem(FILTER_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}

/** E.g. "Today", "Yesterday", "Nov 5" or, in another year, "Nov 5, 2025" */
function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round((startOfDay(today) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() && { year: 'numeric' }),
  });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** E.g. "45 min" or "1 h 32 min" */
function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

function openTab(url: string) {
  void browser.tabs.create({ url });
}
