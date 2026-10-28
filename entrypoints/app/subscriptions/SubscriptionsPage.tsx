import {
  memo,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Clock, Play } from 'lucide-react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { AspectRatio } from '@astryxdesign/core/AspectRatio';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import type { Channel, Video } from '@/utils/youtube';
import { PlayableLink } from '../player';
import { foldForSearch, useSearchShortcut } from '../search';
import { saveToWatchLater } from '../watch-later/store';
import { useGroupFilter, useGroups } from './groups';
import { AddToGroupButton, GroupTokens, GroupsNav } from './GroupControls';
import {
  type Feed,
  refresh,
  refreshChannel,
  unsubscribeFrom,
  useSubscriptions,
} from './store';
import {
  VIDEOS_PER_CHANNEL_CHOICES,
  type VideosPerChannel,
  setVideosPerChannel,
  useVideosPerChannel,
} from './videosPerChannel';

export function SubscriptionsPage() {
  const { channels, feeds, status, isRefreshing } = useSubscriptions();
  const videosPerChannel = useVideosPerChannel();
  const { groups, isLoaded: groupsLoaded } = useGroups();
  const storedFilter = useGroupFilter();
  // A group deleted meanwhile, e.g. in another tab, leaves all channels shown.
  const filterGroup = groups.find((g) => g.id === storedFilter);
  const filter =
    storedFilter === 'ungrouped' || filterGroup || !groupsLoaded ? storedFilter : 'all';
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(foldForSearch(query.trim()));
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  // Coming back to the browser tab updates the feeds that got old meanwhile.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh(false);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const inFilter = useMemo(() => {
    if (filter === 'all') return () => true;
    if (filter === 'ungrouped') {
      const grouped = new Set(groups.flatMap((g) => g.channelIds));
      return (c: Channel) => !grouped.has(c.id);
    }
    const ids = new Set(groups.find((g) => g.id === filter)?.channelIds);
    return (c: Channel) => ids.has(c.id);
  }, [filter, groups]);

  const visible = useMemo(() => {
    const keys = new Map(channels.map((c) => [c.id, recency(feeds[c.id])]));
    return [...channels]
      .sort((a, b) => compareRecency(keys.get(a.id)!, keys.get(b.id)!))
      .filter(
        (c) => inFilter(c) && matchesQuery(c, feeds[c.id], videosPerChannel, deferredQuery),
      );
  }, [channels, feeds, videosPerChannel, deferredQuery, inFilter]);

  // Only the first channels render, and more as the end of the list scrolls
  // into view: hundreds of them at once make the page slow to show. A new
  // search or group starts again from the top.
  const [shownCount, setShownCount] = useState(CHANNELS_PER_PAGE);
  const [shownView, setShownView] = useState({ query: deferredQuery, filter });
  if (shownView.query !== deferredQuery || shownView.filter !== filter) {
    setShownView({ query: deferredQuery, filter });
    setShownCount(CHANNELS_PER_PAGE);
  }
  const shown = visible.slice(0, shownCount);

  // Another group, e.g. picked by a channel's token far down the list, shows
  // from its top. Only on a change, as Activity runs effects again whenever
  // the page is shown.
  const contentRef = useRef<HTMLDivElement>(null);
  const scrolledFilter = useRef(filter);
  useEffect(() => {
    if (scrolledFilter.current === filter) return;
    scrolledFilter.current = filter;
    contentRef.current?.scrollTo({ top: 0 });
  }, [filter]);

  return (
    <Layout
      contentWidth={1200}
      header={
        <LayoutHeader hasDivider padding={6}>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Heading level={1}>Subs</Heading>
            <TextInput
              ref={searchRef}
              label="Search channels and videos"
              isLabelHidden
              placeholder="Search channels and videos"
              value={query}
              onChange={setQuery}
              hasClear
              autoComplete="off"
              width={280}
            />
            <StackItem size="fill">
              <span className={status.isError ? 'status error' : 'status'} role="status">
                <Text type="supporting" color="inherit">
                  {status.text}
                </Text>
              </span>
            </StackItem>
            <Selector
              label="Videos per channel"
              isLabelHidden
              variant="secondary"
              options={VIDEOS_PER_CHANNEL_CHOICES.map((n) => ({
                value: String(n),
                label: `${n} per channel`,
              }))}
              value={String(videosPerChannel)}
              onChange={(value) => setVideosPerChannel(Number(value) as VideosPerChannel)}
            />
            <Button
              label="Refresh"
              isLoading={isRefreshing}
              onClick={() => void refresh(true)}
            />
          </HStack>
        </LayoutHeader>
      }
      start={<GroupsNav channels={channels} filter={filter} />}
      content={
        <LayoutContent ref={contentRef} padding={6}>
          {visible.length === 0 && channels.length > 0 && groupsLoaded ? (
            <EmptyState
              headingLevel={2}
              isCompact
              {...(deferredQuery
                ? { title: 'No matching channels' }
                : filter === 'ungrouped'
                  ? { title: 'Every channel is in a group' }
                  : {
                      title: `No channels in ${filterGroup?.name}`,
                      description: 'Add channels with the Add to group button next to each.',
                    })}
            />
          ) : (
            <VStack gap={4}>
              {shown.map((channel, i) => (
                <VStack key={channel.id} gap={4}>
                  {i > 0 && <Divider />}
                  <ChannelSection
                    channel={channel}
                    feed={feeds[channel.id]}
                    videosPerChannel={videosPerChannel}
                  />
                </VStack>
              ))}
              {shown.length < visible.length && (
                <ShowMore
                  shownCount={shownCount}
                  onShowMore={() => setShownCount(shownCount + CHANNELS_PER_PAGE)}
                />
              )}
            </VStack>
          )}
        </LayoutContent>
      }
    />
  );
}

const CHANNELS_PER_PAGE = 30;

/** Shows more channels once the user scrolls near the end of the list. */
function ShowMore({
  shownCount,
  onShowMore,
}: {
  shownCount: number;
  onShowMore: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const showMore = useEffectEvent(onShowMore);

  // Observing anew after each page also catches the case where it didn't fill
  // the screen and the end of the list is still in view.
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) showMore();
      },
      // Render the next channels a bit before the end is actually reached.
      { rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shownCount]);

  return <div ref={ref} />;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How recent the channel's latest video is, to sort channels by. YouTube only
 * tells videos' age, in days, weeks… once they're a day old, so channels whose
 * latest videos are as old by that measure go by those videos' views instead.
 */
function recency(feed: Feed | undefined): number[] {
  const video = feed?.videos[0];
  if (!video) return [2];
  const published = Date.parse(video.published);
  // Rounded since the feed was stamped a moment after its ages were counted.
  const age = Math.round((feed.fetchedAt - published) / MINUTE) * MINUTE;
  return age < DAY ? [0, -published] : [1, age, -(video.views ?? 0)];
}

function compareRecency(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Whether the channel name or one of its shown video titles contains the query. */
function matchesQuery(
  channel: Channel,
  feed: Feed | undefined,
  videosPerChannel: number,
  query: string,
) {
  if (!query) return true;
  const videos = (feed?.videos ?? []).slice(0, videosPerChannel);
  return [channel.title, ...videos.map((v) => v.title)].some((text) =>
    foldForSearch(text).includes(query),
  );
}

// Memoized so progress updates during a refresh only re-render the channels
// whose feed changed.
const ChannelSection = memo(function ChannelSection({
  channel,
  feed,
  videosPerChannel,
}: {
  channel: Channel;
  feed: Feed | undefined;
  videosPerChannel: number;
}) {
  const videos = (feed?.videos ?? []).slice(0, videosPerChannel);
  return (
    <section>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <a
                className="channel-header"
                href={`https://www.youtube.com/channel/${channel.id}/videos`}
              >
                <HStack gap={2} vAlign="center">
                  <Avatar src={channel.avatar} name={channel.title} size={32} tooltip={false} />
                  <span className="channel-title">
                    <Text weight="medium" size="base">
                      {channel.title}
                    </Text>
                  </span>
                  {videos[0] && (
                    <Age published={videos[0].published} />
                  )}
                </HStack>
              </a>
              {/* Outside the link, which can't hold their buttons */}
              <GroupTokens channelId={channel.id} />
            </HStack>
          </StackItem>
          <AddToGroupButton channel={channel} />
          <UnsubscribeButton channel={channel} />
        </HStack>
        {videos.length ? (
          // All the chosen videos in one row, unless the window is too narrow
          // for them; fewer than 3 keep the width they have in a row of 3.
          <Grid
            columns={{
              minWidth: videosPerChannel > 3 ? 200 : 280,
              max: Math.max(3, videosPerChannel),
            }}
            gap={4}
          >
            {videos.map((video) => (
              <VideoLink key={video.id} video={video} channelId={channel.id} />
            ))}
          </Grid>
        ) : (
          <Text type="supporting">{feed ? 'No videos' : 'Loading…'}</Text>
        )}
      </VStack>
    </section>
  );
});

/** First click asks for confirmation, a second click within a few seconds unsubscribes. */
function UnsubscribeButton({ channel }: { channel: Channel }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'pending'>('idle');

  useEffect(() => {
    if (state !== 'confirm') return;
    const timer = setTimeout(() => setState('idle'), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'idle') {
    return (
      <Button
        label="Unsubscribe"
        variant="ghost"
        size="sm"
        onClick={() => setState('confirm')}
      />
    );
  }
  return (
    <Button
      label="Confirm unsubscribe"
      variant="destructive"
      size="sm"
      isLoading={state === 'pending'}
      onClick={async () => {
        setState('pending');
        try {
          // On success the channel, and with it this button, goes away.
          await unsubscribeFrom(channel);
        } catch (err) {
          console.error(err);
          setState('idle');
        }
      }}
    />
  );
}

const compactNumber = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** The units YouTube tells ages in, each with the age up to which it's used */
const AGE_STEPS: [unit: Intl.RelativeTimeFormatUnit, size: number, limit: number][] = [
  ['second', SECOND, MINUTE],
  ['minute', MINUTE, HOUR],
  ['hour', HOUR, DAY],
  ['day', DAY, 7 * DAY],
  // Up to 5 weeks rather than a month, since "4 weeks ago" dates videos 4½
  // weeks back.
  ['week', 7 * DAY, 5 * 7 * DAY],
  ['month', 30 * DAY, 365 * DAY],
  ['year', 365 * DAY, Infinity],
];

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });
// For "yesterday", and "now" rather than "0 seconds ago"
const relativeTimeInWords = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/**
 * How long ago a video came out, in the units YouTube uses, e.g. "3 weeks
 * ago": no more precise than the age YouTube told, where Timestamp would show
 * some number of days.
 */
function Age({ published }: { published: string }) {
  const age = Math.max(0, Date.now() - Date.parse(published));
  const [unit, size] = AGE_STEPS.find(([, , limit]) => age < limit)!;
  const count = Math.floor(age / size);
  const format = unit === 'day' || unit === 'second' ? relativeTimeInWords : relativeTime;
  return (
    <Text type="supporting">
      <time dateTime={published}>{format.format(-count, unit)}</time>
    </Text>
  );
}

function VideoLink({ video, channelId }: { video: Video; channelId: string }) {
  const showToast = useToast();
  return (
    <div className="video-item">
      <PlayableLink
        className="video"
        video={video}
        // The full title, which may be cut short
        data-tooltip={video.title}
        // Shows how much of the video was watched in the player.
        onPlayerClose={() => void refreshChannel(channelId)}
      >
        <HStack gap={2} vAlign="start">
          <div className="thumbnail">
            <AspectRatio ratio={16 / 9} fit="cover">
              <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" loading="lazy" />
            </AspectRatio>
            {video.duration && <span className="duration">{video.duration}</span>}
            {video.progress ? (
              <span
                className="progress"
                style={{ '--progress': `${video.progress}%` } as React.CSSProperties}
              />
            ) : null}
          </div>
          <VStack gap={1}>
            <span className="video-title">
              <Text weight="medium" size="sm" maxLines={3} hasTruncateTooltip={false}>
                {video.title}
              </Text>
            </span>
            <HStack gap={1} vAlign="center" wrap="wrap">
              {video.views !== undefined && (
                <>
                  {/* Like the view counts on Feed */}
                  <Text type="supporting">
                    <span className="detail" aria-hidden>
                      <Icon icon={Play} size="xsm" />
                      {compactNumber.format(video.views)}
                    </span>
                    <VisuallyHidden>{`${video.views.toLocaleString()} views`}</VisuallyHidden>
                  </Text>
                  <Text type="supporting">·</Text>
                </>
              )}
              <Age published={video.published} />
            </HStack>
          </VStack>
        </HStack>
      </PlayableLink>
      {/* Next to the link rather than in it, which can't hold a button. The
          browser's own tooltip, since an Astryx Tooltip on each of hundreds of
          videos makes the page take many seconds to render. */}
      <span className="save-later" title="Save to Watch later">
        <Button
          label="Save to Watch later"
          isIconOnly
          icon={<Icon icon={Clock} />}
          variant="ghost"
          size="sm"
          onClick={() => void saveToWatchLater(video, showToast)}
        />
      </span>
    </div>
  );
}
