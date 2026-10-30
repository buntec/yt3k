import { memo, useDeferredValue, useEffect, useRef, useState } from 'react';
import { EllipsisVertical, type LucideIcon, Play } from 'lucide-react';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import type { ListedVideo, MetadataPart } from '@/utils/youtube';
import { PlayableLink } from '../player';
import { foldForSearch, useSearchShortcut } from '../search';
import { COLUMN_CHOICES, type Columns, setColumns, useColumns } from './columns';
import type { Removal, VideoList, VideoListState } from './list';

export type ShowToast = ReturnType<typeof useToast>;

/** An item in a video's menu */
export interface VideoAction {
  label: string;
  icon: LucideIcon;
  run: (showToast: ShowToast) => void;
}

/**
 * A page with a grid of videos from YouTube. `actions` gives each video's
 * menu; define it outside components, so cards don't re-render needlessly.
 * `start` is a side panel, and `include` with `filteredEmpty` a filter it
 * sets, such as Live's groups.
 */
export function VideoListView({
  title,
  list,
  loadingText,
  empty,
  actions,
  start,
  include,
  filteredEmpty,
}: {
  title: string;
  list: VideoList;
  loadingText: string;
  empty: { title: string; description?: string };
  actions: (video: ListedVideo) => VideoAction[];
  start?: React.ReactNode;
  include?: (video: ListedVideo) => boolean;
  filteredEmpty?: { title: string; description?: string };
}) {
  const { videos: loaded, continuation, loading, error, removalError, removals } = list.use();
  const videos = include ? loaded.filter(include) : loaded;
  const columns = useColumns();
  const status = loading === 'refresh' ? loadingText : (error ?? removalError);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);
  const matching = deferredQuery
    ? videos.filter((video) => matchesQuery(video, deferredQuery))
    : videos;

  // Removing a channel hides its other videos as well.
  const hiddenChannels = new Set(
    Object.values(removals).flatMap((r) => (r?.channelUrl ? [r.channelUrl] : [])),
  );

  return (
    // With a side panel, no contentWidth, as on Subs: Layout would align the
    // panel to the centered frame, leaving a gap at the window's edge. The
    // videos are capped instead.
    <Layout
      contentWidth={start ? undefined : 1600}
      start={start}
      header={
        <LayoutHeader hasDivider padding={6}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={1}>{title}</Heading>
            <TextInput
              ref={searchRef}
              label="Search videos and channels"
              isLabelHidden
              placeholder="Search videos and channels"
              value={query}
              onChange={setQuery}
              hasClear
              autoComplete="off"
              width={280}
            />
            <StackItem size="fill">
              <span className={error || removalError ? 'status error' : 'status'} role="status">
                <Text type="supporting" color="inherit">
                  {status}
                </Text>
              </span>
            </StackItem>
            <Selector
              label="Videos per row"
              isLabelHidden
              variant="secondary"
              options={COLUMN_CHOICES.map((n) => ({ value: String(n), label: `${n} per row` }))}
              value={String(columns)}
              onChange={(value) => setColumns(Number(value) as Columns)}
            />
            <Button
              label="Refresh"
              isLoading={loading === 'refresh'}
              onClick={() => void list.refresh()}
            />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={6}>
          {videos.length === 0 ? (
            loading === 'idle' &&
            !error &&
            (loaded.length > 0 && filteredEmpty ? (
              <EmptyState
                title={filteredEmpty.title}
                description={filteredEmpty.description}
                headingLevel={2}
                isCompact
              />
            ) : (
              <EmptyState title={empty.title} description={empty.description} headingLevel={2} />
            ))
          ) : (
            <VStack gap={8} maxWidth={start ? 1600 : undefined}>
              {deferredQuery && matching.length === 0 && (
                <EmptyState
                  title="No matching videos"
                  description={
                    continuation ? 'Only the videos loaded so far were searched.' : undefined
                  }
                  headingLevel={2}
                  isCompact
                />
              )}
              {groupByDay(matching).map((group, i) => (
                <VStack key={i} as="section" gap={4}>
                  {group.day && <Heading level={2}>{group.day}</Heading>}
                  {/* The chosen number of columns, unless the window is too
                      narrow for cards of a still readable width */}
                  <Grid columns={{ minWidth: 160, max: columns }} columnGap={4} rowGap={8}>
                    {group.videos.map((video) => {
                      const removal = removals[video.id];
                      if (removal) {
                        return (
                          <RemovedCard
                            key={video.id}
                            removal={removal}
                            onUndo={() => void list.undoRemoval(video.id)}
                          />
                        );
                      }
                      if (video.channel?.url && hiddenChannels.has(video.channel.url)) {
                        return null;
                      }
                      return <VideoCard key={video.id} video={video} actions={actions} />;
                    })}
                  </Grid>
                </VStack>
              ))}
              {continuation && (
                <ShowMore
                  list={list}
                  loading={loading}
                  // A search that matches little would otherwise keep loading
                  // page after page, through years of history.
                  isAutomatic={!deferredQuery && error === undefined}
                />
              )}
            </VStack>
          )}
        </LayoutContent>
      }
    />
  );
}

/**
 * Whether the video's title or channel contains the query. Only searches the
 * videos loaded so far: YouTube's lists can go back years.
 */
function matchesQuery(video: ListedVideo, query: string) {
  return [video.title, video.channel?.title ?? ''].some((text) =>
    foldForSearch(text).includes(query),
  );
}

/**
 * Runs of videos watched on the same day (History), headed by that day. Lists
 * without days are one group without heading. A day can go on in the next
 * page, so groups follow the videos rather than YouTube's pages.
 */
function groupByDay(videos: ListedVideo[]) {
  const groups: { day?: string; videos: ListedVideo[] }[] = [];
  for (const video of videos) {
    const last = groups.at(-1);
    if (last && last.day === video.watchedOn) last.videos.push(video);
    else groups.push({ day: video.watchedOn, videos: [video] });
  }
  return groups;
}

/**
 * Loads the next page once the user scrolls near the end of the list, if
 * `isAutomatic`. The button stays as a fallback, and otherwise, such as after
 * a failure, it is the only way to load more, so a broken request isn't
 * repeated on every scroll.
 */
function ShowMore({
  list,
  loading,
  isAutomatic,
}: {
  list: VideoList;
  loading: VideoListState['loading'];
  isAutomatic: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Observing anew after each load also catches the case where the new page
  // didn't fill the screen and the end of the list is still in view.
  useEffect(() => {
    if (loading !== 'idle' || !isAutomatic || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void list.loadMore();
      },
      // Start loading a bit before the end is actually reached.
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [list, loading, isAutomatic]);

  return (
    <div ref={ref}>
      <Center>
        <Button
          label="Show more"
          isLoading={loading === 'more'}
          onClick={() => void list.loadMore()}
        />
      </Center>
    </div>
  );
}

// Memoized so appending a page doesn't re-render the cards already shown.
const VideoCard = memo(function VideoCard({
  video,
  actions,
}: {
  video: ListedVideo;
  actions: (video: ListedVideo) => VideoAction[];
}) {
  const { channel } = video;
  return (
    <article>
      <VStack gap={3}>
        {/* The title links to the same video, so this one is skipped by
            keyboard and screen readers. */}
        <PlayableLink
          video={video}
          className="card-thumbnail"
          tabIndex={-1}
          aria-hidden
          data-tooltip={video.title}
        >
          <AspectRatio ratio={16 / 9} fit="cover">
            <img src={video.thumbnail} alt="" loading="lazy" />
          </AspectRatio>
          {video.duration && <span className="duration">{video.duration}</span>}
          {video.progress ? (
            <span
              className="progress"
              style={{ '--progress': `${video.progress}%` } as React.CSSProperties}
            />
          ) : null}
        </PlayableLink>
        <HStack gap={3} vAlign="start">
          {/* Watch later doesn't list avatars, and initials alone say little. */}
          {channel?.avatar && (
            <Avatar
              src={channel.avatar}
              name={channel.title}
              size={36}
              href={channel.url}
              tooltip={false}
            />
          )}
          <StackItem size="fill">
            <VStack gap={1}>
              {/* Both links show the full title, which may be cut short, in a
                  tooltip. */}
              <PlayableLink video={video} className="video" data-tooltip={video.title}>
                <span className="video-title">
                  <Text weight="medium" maxLines={2} hasTruncateTooltip={false}>
                    {video.title}
                  </Text>
                </span>
              </PlayableLink>
              {channel &&
                (channel.url ? (
                  <a className="channel-link" href={channel.url}>
                    <Text type="supporting">{channel.title}</Text>
                  </a>
                ) : (
                  <Text type="supporting">{channel.title}</Text>
                ))}
              <Text type="supporting">
                {video.details.map((part, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <Detail part={part} />
                  </span>
                ))}
              </Text>
            </VStack>
          </StackItem>
          <VideoMenu items={actions(video)} />
        </HStack>
      </VStack>
    </article>
  );
});

function VideoMenu({ items }: { items: VideoAction[] }) {
  const showToast = useToast();
  if (items.length === 0) return null;
  return (
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
      items={items.map((item) => ({
        label: item.label,
        icon: item.icon,
        onClick: () => item.run(showToast),
      }))}
    />
  );
}

/** Takes the place of a video the user took out of the list, like on YouTube. */
function RemovedCard({ removal, onUndo }: { removal: Removal; onUndo: () => void }) {
  return (
    <article>
      <AspectRatio ratio={16 / 9}>
        <div className="removed">
          <VStack gap={3} hAlign="center">
            <Text justify="center">{removal.message}</Text>
            {removal.undo && (
              <Button
                label="Undo"
                size="sm"
                // A removal can only be undone once YouTube has it.
                isDisabled={removal.status === 'sending'}
                isLoading={removal.status === 'undoing'}
                onClick={onUndo}
              />
            )}
          </VStack>
        </div>
      </AspectRatio>
    </article>
  );
}

function Detail({ part }: { part: MetadataPart }) {
  const visible = (
    <span className="detail">
      {part.hasPlayIcon && <Icon icon={Play} size="xsm" />}
      {part.text}
    </span>
  );
  if (!part.label) return visible;
  return (
    <>
      <span aria-hidden>{visible}</span>
      <VisuallyHidden>{part.label}</VisuallyHidden>
    </>
  );
}
