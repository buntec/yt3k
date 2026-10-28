import { extensionHost } from './extension';

const ORIGIN = 'https://www.youtube.com';

export interface Channel {
  id: string;
  title: string;
  avatar: string;
  /** Opaque parameter YouTube's own unsubscribe button sends along */
  unsubscribeParams?: string;
}

export interface Video {
  id: string;
  title: string;
  /** ISO 8601 timestamp, as precise as the age YouTube shows, e.g. "3 weeks ago" */
  published: string;
  /** Rounded the way YouTube shows it, e.g. 1.2M */
  views?: number;
  /** Badge on the thumbnail, e.g. "21:52" */
  duration?: string;
  /** How much of the video the user has watched, in percent */
  progress?: number;
}

/** A video in a list on YouTube (Home, Watch later, History), as YouTube describes it there. */
export interface ListedVideo {
  id: string;
  title: string;
  thumbnail: string;
  /** Badge on the thumbnail, e.g. "21:52" or "LIVE" */
  duration?: string;
  /** Collaborations list several channels in `title` but link the first */
  channel?: { title: string; url?: string; avatar?: string };
  /** What YouTube lists after the channel name, e.g. view count and age */
  details: MetadataPart[];
  /** How much of the video the user has watched, in percent */
  progress?: number;
  /** Feedback YouTube offers in the video's menu (Home and History) */
  feedback: {
    notInterested?: FeedbackAction;
    dontRecommendChannel?: FeedbackAction;
    removeFromHistory?: FeedbackAction;
  };
  /** The edit that removes this entry from Watch later (Watch later only) */
  watchLaterRemoval?: PlaylistEdit;
  /** The day YouTube lists it under, e.g. "Today" or "Oct 20" (History only) */
  watchedOn?: string;
}

/** A change to a playlist, as YouTube's own buttons describe it */
export type PlaylistEdit = Record<string, unknown>;

/** Tokens for one of the feedback items in a video's menu */
export interface FeedbackAction {
  token: string;
  /** Token that takes the feedback back again */
  undoToken?: string;
}

export interface MetadataPart {
  text: string;
  /** Fuller text for screen readers, e.g. "4.7 thousand views" for "4.7K" */
  label?: string;
  /** YouTube shows a play icon before view counts */
  hasPlayIcon: boolean;
}

/** The YouTube account requests are made as */
export interface Account {
  name: string;
  /** e.g. "@name"; accounts without a channel have none */
  handle?: string;
  avatar?: string;
}

/** Thrown when there are no YouTube login cookies to sign requests with. */
export class NotLoggedInError extends Error {
  constructor() {
    super('Not logged in to YouTube');
  }
}

export interface VideoListPage {
  videos: ListedVideo[];
  /** Token for the next page, if there is one */
  continuation?: string;
}

/**
 * All channels the logged-in user is subscribed to, read from the data
 * embedded in YouTube's "All subscriptions" page.
 */
export async function fetchSubscriptions(): Promise<Channel[]> {
  const res = await fetch('https://www.youtube.com/feed/channels', {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Loading subscriptions failed (${res.status})`);

  const html = await res.text();
  rememberClientConfig(html);
  const channels = parseSubscriptionsPage(html);
  if (channels.length === 0) {
    throw new Error('No subscriptions found. Are you logged in to YouTube?');
  }
  return channels;
}

/** The channels listed in the HTML of YouTube's "All subscriptions" page. */
export function parseSubscriptionsPage(html: string): Channel[] {
  const data = initialData(html);
  if (!data) throw new Error('Subscription data not found on YouTube page');

  return findAll(data, 'channelRenderer').map(
    (renderer): Channel => ({
      id: renderer.channelId,
      title: renderer.title?.simpleText?.trim() ?? renderer.channelId,
      avatar: new URL(
        renderer.thumbnail.thumbnails.at(-1).url,
        'https://www.youtube.com',
      ).href,
      unsubscribeParams: findAll(
        renderer.subscribeButton?.subscribeButtonRenderer?.onUnsubscribeEndpoints,
        'unsubscribeEndpoint',
      )[0]?.params,
    }),
  );
}

/** What YouTube's own link to a channel's Videos tab sends along */
const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';
const VIDEOS_ATTEMPTS = 4;

/** A channel's latest long-form uploads (no Shorts or streams), newest first. */
export async function fetchLatestVideos(
  channelId: string,
  limit: number,
): Promise<Video[]> {
  for (let attempt = 1; ; attempt++) {
    // In English, whatever the user's language, so that the ages can be read.
    const { status, data } = await innertubeRequest(
      'browse',
      { browseId: channelId, params: VIDEOS_TAB_PARAMS },
      { language: 'en' },
    );
    if (status === 200) return parseChannelVideos(data, Date.now()).slice(0, limit);
    // YouTube turns some requests away (429, or 500 now and then) when many
    // come at once, like while loading all subscriptions: try those again a
    // little later, waiting longer each time.
    if ((status !== 429 && status < 500) || attempt === VIDEOS_ATTEMPTS) {
      throw new Error(`Loading videos failed (${status})`);
    }
    const delay = 1000 * 2 ** attempt * (0.5 + Math.random());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * The videos in YouTube's API response for a channel's Videos tab, in
 * English. YouTube only tells their age, e.g. "3 weeks ago", so `published`
 * is as precise as that, counted back from `now`: the middle of the age's
 * range, 3½ weeks ago for one that's between 3 and 4 weeks old.
 */
export function parseChannelVideos(data: unknown, now: number): Video[] {
  const items = findAll(data, 'richGridRenderer')[0]?.contents;
  return (Array.isArray(items) ? items : [])
    .map((item) => item.richItemRenderer?.content?.lockupViewModel)
    .filter((lockup) => lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
    .map((lockup): Video | undefined => {
      const metadata = lockup.metadata?.lockupMetadataViewModel;
      // For logged-in users YouTube writes them short, e.g. "1.5M" and
      // "2w ago", and in full in the label: "1.5 million views", "2 weeks ago".
      const texts: string[] = findAll(metadata?.metadata, 'metadataParts')
        .flat()
        .flatMap((part) => [part.accessibilityLabel, part.text?.content])
        .filter((text) => typeof text === 'string');
      const age = texts.map(parseAge).find((age) => age !== undefined);
      // Upcoming premieres and streams have no age yet.
      if (!lockup.contentId || age === undefined) return undefined;
      return {
        id: lockup.contentId,
        title: metadata.title?.content ?? '',
        published: new Date(now - age).toISOString(),
        views: texts.map(parseViews).find((views) => views !== undefined),
        duration: findAll(lockup.contentImage, 'thumbnailBadgeViewModel')[0]?.text,
        progress: findAll(lockup.contentImage, 'thumbnailOverlayProgressBarViewModel')[0]
          ?.startPercent,
      };
    })
    .filter((video) => video !== undefined);
}

const AGE_UNITS = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

const SHORT_AGE_UNITS: Record<string, keyof typeof AGE_UNITS> = {
  s: 'second',
  min: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  mo: 'month',
  y: 'year',
};

/**
 * Milliseconds in an age like "53 minutes ago", "2w ago" or "Streamed 1 year
 * ago", taken from the middle of the range it rounds down: 2½ weeks for "2w".
 * A relative time shown for it then reads like YouTube's even with a clock a
 * few minutes off from the one it was counted back from.
 */
function parseAge(text: string): number | undefined {
  const match =
    text.match(/\b(\d+) (second|minute|hour|day|week|month|year)s? ago$/) ??
    text.match(/\b(\d+) ?(s|min|h|d|w|mo|y) ago$/);
  if (!match) return undefined;
  const unit = SHORT_AGE_UNITS[match[2]!] ?? (match[2] as keyof typeof AGE_UNITS);
  return (Number(match[1]) + 0.5) * AGE_UNITS[unit];
}

const VIEW_SCALES: Record<string, number> = {
  '': 1,
  K: 1e3,
  thousand: 1e3,
  M: 1e6,
  million: 1e6,
  B: 1e9,
  billion: 1e9,
};

/** The number in a view count like "1.5 million views", "1.2M views", "60" or "No views" */
function parseViews(text: string): number | undefined {
  if (text === 'No views') return 0;
  const match = text.match(/^([\d.,]+) ?(K|M|B|thousand|million|billion)?( views?)?$/);
  if (!match) return undefined;
  const scale = VIEW_SCALES[match[2] ?? '']!;
  return Math.round(Number(match[1]!.replaceAll(',', '')) * scale);
}

/**
 * The first page of the logged-in user's recommendations, read from the data
 * embedded in YouTube's Home page.
 */
export async function fetchHomeFeed(): Promise<VideoListPage> {
  const res = await fetch('https://www.youtube.com/', { credentials: 'include' });
  if (!res.ok) throw new Error(`Loading recommendations failed (${res.status})`);

  const html = await res.text();
  rememberClientConfig(html);
  const page = parseHomePage(html);
  if (page.videos.length === 0) {
    throw new Error('No recommendations found. Are you logged in to YouTube?');
  }
  return page;
}

/** The page of recommendations that follows the one `continuation` came with. */
export async function fetchMoreHomeFeed(continuation: string): Promise<VideoListPage> {
  const { status, data } = await innertubeRequest('browse', { continuation });
  if (status !== 200) throw new Error(`Loading more recommendations failed (${status})`);
  return parseHomeContinuation(data);
}

/** The recommendations in the HTML of YouTube's Home page. */
export function parseHomePage(html: string): VideoListPage {
  const data = initialData(html);
  if (!data) throw new Error('Recommendations not found on YouTube page');
  return parseFeedItems(findAll(data, 'richGridRenderer')[0]?.contents);
}

/** The recommendations in YouTube's API response for the next page of Home. */
export function parseHomeContinuation(data: unknown): VideoListPage {
  return parseFeedItems(findAll(data, 'continuationItems').flat());
}

function parseFeedItems(items: unknown): VideoListPage {
  // Only top-level grid items: shelves (Shorts, Playables, topic chips) also
  // contain lockups, but aren't part of the main feed.
  const lockups = (Array.isArray(items) ? items : [])
    .map((item) => item.richItemRenderer?.content?.lockupViewModel)
    .filter((lockup) => lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO');
  return {
    videos: lockups.map(parseLockup).filter((video) => video !== undefined),
    continuation: findAll(items, 'continuationCommand').at(-1)?.token,
  };
}

function parseLockup(lockup: any): ListedVideo | undefined {
  const metadata = lockup.metadata?.lockupMetadataViewModel;
  if (!lockup.contentId || !metadata) return undefined;

  const parts: any[] = findAll(metadata.metadata, 'metadataParts').flat();
  const browse = findAll(metadata.image, 'browseEndpoint')[0];
  const channelTitle = parts[0]?.text?.content;
  return {
    id: lockup.contentId,
    title: metadata.title?.content ?? '',
    thumbnail:
      lockup.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ??
      `https://i.ytimg.com/vi/${lockup.contentId}/mqdefault.jpg`,
    duration: findAll(lockup.contentImage, 'thumbnailBadgeViewModel')[0]?.text,
    progress: findAll(lockup.contentImage, 'thumbnailOverlayProgressBarViewModel')[0]
      ?.startPercent,
    channel: channelTitle && {
      title: channelTitle,
      url: channelUrl(browse),
      avatar: absoluteUrl(findAll(metadata.image, 'avatarViewModel')[0]?.image?.sources?.[0]?.url),
    },
    details: parts
      .slice(channelTitle ? 1 : 0)
      .filter((part) => part.text?.content)
      .map((part) => ({
        text: part.text.content,
        label: part.accessibilityLabel,
        hasPlayIcon: part.leadingIcon?.name?.startsWith('PLAY_ARROW') ?? false,
      })),
    feedback: parseFeedbackActions(metadata.menuButton),
  };
}

/**
 * The "Not interested", "Don't recommend channel" and "Remove from watch
 * history" items of a video's menu. They are told apart by icon, since their
 * labels are in the user's language.
 */
function parseFeedbackActions(menu: unknown): ListedVideo['feedback'] {
  const feedback: ListedVideo['feedback'] = {};
  for (const item of findAll(menu, 'listItemViewModel')) {
    const endpoint = findAll(item, 'feedbackEndpoint')[0];
    if (!endpoint?.feedbackToken) continue;
    const action = {
      token: endpoint.feedbackToken,
      undoToken: findAll(endpoint, 'undoToken')[0],
    };
    const icon = findAll(item.leadingImage, 'imageName')[0];
    if (icon === 'HIDE') feedback.notInterested = action;
    else if (icon === 'REMOVE') feedback.dontRecommendChannel = action;
    else if (icon === 'DELETE') feedback.removeFromHistory = action;
  }
  return feedback;
}

/** Sends one of the feedback items of a video's menu, like clicking it on YouTube. */
export async function sendFeedback(action: FeedbackAction): Promise<void> {
  await feedbackRequest({
    feedbackTokens: [action.token],
    isFeedbackTokenUnencrypted: false,
    shouldMerge: false,
  });
}

/** Takes feedback back, like the Undo button YouTube shows after it. */
export async function undoFeedback(action: FeedbackAction): Promise<void> {
  if (!action.undoToken) throw new Error("This feedback can't be undone");
  await feedbackRequest({ feedbackTokens: [action.undoToken] });
}

async function feedbackRequest(body: Record<string, unknown>) {
  const { status, data } = await innertubeRequest('feedback', body);
  // The response lists whether each token was processed.
  const responses = findAll(data, 'feedbackResponses').flat();
  if (status !== 200 || responses.some((r) => r?.isProcessed === false)) {
    throw new Error(`Sending feedback failed (${status})`);
  }
}

/** The logged-in user's Watch later playlist, read from the data embedded in its page. */
export async function fetchWatchLater(): Promise<VideoListPage> {
  const res = await fetch('https://www.youtube.com/playlist?list=WL', {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Loading Watch later failed (${res.status})`);

  const html = await res.text();
  rememberClientConfig(html);
  return parseWatchLaterPage(html);
}

/** The part of Watch later that follows the one `continuation` came with. */
export async function fetchMoreWatchLater(continuation: string): Promise<VideoListPage> {
  const { status, data } = await innertubeRequest('browse', { continuation });
  if (status !== 200) throw new Error(`Loading more of Watch later failed (${status})`);
  return parseWatchLaterContinuation(data);
}

/** The videos in the HTML of YouTube's Watch later page. */
export function parseWatchLaterPage(html: string): VideoListPage {
  const data = initialData(html);
  if (!data) throw new Error('Watch later not found on YouTube page');
  return parsePlaylistItems(findAll(data, 'playlistVideoListRenderer')[0]?.contents);
}

/** The videos in YouTube's API response for the next part of Watch later. */
export function parseWatchLaterContinuation(data: unknown): VideoListPage {
  return parsePlaylistItems(findAll(data, 'continuationItems').flat());
}

function parsePlaylistItems(items: unknown): VideoListPage {
  const renderers = (Array.isArray(items) ? items : [])
    .map((item) => item.playlistVideoRenderer)
    .filter((renderer) => renderer?.videoId);
  return {
    videos: renderers.map(parsePlaylistVideo),
    continuation: findAll(items, 'continuationCommand').at(-1)?.token,
  };
}

function parsePlaylistVideo(renderer: any): ListedVideo {
  const byline = renderer.shortBylineText?.runs?.[0];
  const browse = byline?.navigationEndpoint?.browseEndpoint;
  return {
    id: renderer.videoId,
    title: renderer.title?.runs?.map((run: any) => run.text).join('') ?? '',
    thumbnail:
      absoluteUrl(renderer.thumbnail?.thumbnails?.at(-1)?.url) ??
      `https://i.ytimg.com/vi/${renderer.videoId}/mqdefault.jpg`,
    duration: renderer.lengthText?.simpleText,
    channel: byline?.text && {
      title: byline.text,
      url: channelUrl(browse),
    },
    // E.g. "34K", " • ", "7 years ago": the view count gets the play icon
    // it has on Home.
    details: (renderer.videoInfo?.runs ?? [])
      .map((run: any) => run.text?.trim())
      .filter((text: string | undefined) => text && !/^[•·]$/.test(text))
      .map((text: string, i: number) => ({ text, hasPlayIcon: i === 0 && /^\d/.test(text) })),
    progress: findAll(renderer.thumbnailOverlays, 'percentDurationWatched')[0],
    feedback: {},
    watchLaterRemoval: parseRemoval(renderer.menu),
  };
}

/**
 * The "Remove from Watch later" item of a playlist entry's menu, told apart
 * from the other items by icon. Only the parts YouTube sends when it's clicked.
 */
function parseRemoval(menu: unknown): PlaylistEdit | undefined {
  const item = findAll(menu, 'menuServiceItemRenderer').find(
    (item) => item.icon?.iconType === 'DELETE',
  );
  const edit = findAll(item, 'playlistEditEndpoint')[0];
  if (!edit) return undefined;
  const { playlistId, actions, params } = edit;
  return { playlistId, actions, params };
}

/** Adds the video to Watch later, like "Save to Watch later" on YouTube. */
export async function addToWatchLater(videoId: string): Promise<void> {
  await editPlaylist({
    playlistId: 'WL',
    actions: [{ addedVideoId: videoId, action: 'ACTION_ADD_VIDEO' }],
  });
}

/** Removes the video from Watch later, with its entry's own edit if it has one. */
export async function removeFromWatchLater(
  video: Pick<ListedVideo, 'id' | 'watchLaterRemoval'>,
): Promise<void> {
  await editPlaylist(
    video.watchLaterRemoval ?? {
      playlistId: 'WL',
      actions: [{ removedVideoId: video.id, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }],
    },
  );
}

async function editPlaylist(edit: PlaylistEdit) {
  const { status, data } = await innertubeRequest('browse/edit_playlist', edit);
  const result = (data as { status?: string } | null)?.status;
  if (status !== 200 || (result && result !== 'STATUS_SUCCEEDED')) {
    throw new Error(`Changing Watch later failed (${status})`);
  }
}

/** The logged-in user's watch history, newest first, read from the data embedded in its page. */
export async function fetchHistory(): Promise<VideoListPage> {
  const res = await fetch('https://www.youtube.com/feed/history', { credentials: 'include' });
  if (!res.ok) throw new Error(`Loading history failed (${res.status})`);

  const html = await res.text();
  rememberClientConfig(html);
  return parseHistoryPage(html);
}

/** The part of the history that follows the one `continuation` came with. */
export async function fetchMoreHistory(continuation: string): Promise<VideoListPage> {
  const { status, data } = await innertubeRequest('browse', { continuation });
  if (status !== 200) throw new Error(`Loading more history failed (${status})`);
  return parseHistoryContinuation(data);
}

/** The videos in the HTML of YouTube's History page. */
export function parseHistoryPage(html: string): VideoListPage {
  const data = initialData(html);
  if (!data) throw new Error('History not found on YouTube page');
  return parseHistoryItems(findAll(data, 'sectionListRenderer')[0]?.contents);
}

/** The videos in YouTube's API response for the next part of the history. */
export function parseHistoryContinuation(data: unknown): VideoListPage {
  return parseHistoryItems(findAll(data, 'continuationItems').flat());
}

/**
 * History comes in sections, one per day. A day can go on in the next part,
 * in a section with the same heading. Shorts, in shelves, are left out, and a
 * video watched on several days is only kept on the latest.
 */
function parseHistoryItems(items: unknown): VideoListPage {
  const list: any[] = Array.isArray(items) ? items : [];
  const seen = new Set<string>();
  const videos = list
    .map((item) => item.itemSectionRenderer)
    .filter((section) => section)
    .flatMap((section): ListedVideo[] => {
      const title = section.header?.itemSectionHeaderRenderer?.title;
      const watchedOn = title?.simpleText ?? title?.runs?.map((run: any) => run.text).join('');
      return (section.contents ?? [])
        .map((item: any): ListedVideo | undefined => {
          const lockup = item.lockupViewModel;
          // Most entries are lockups like on Home, but now and then one is
          // described the older way.
          if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') return parseLockup(lockup);
          if (item.videoRenderer?.videoId) return parseVideoRenderer(item.videoRenderer);
          return undefined;
        })
        .filter((video: ListedVideo | undefined) => video !== undefined)
        .map((video: ListedVideo) => ({ ...video, watchedOn }));
    })
    .filter((video) => {
      if (seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    });
  return {
    videos,
    continuation: findAll(
      list.filter((item) => item.continuationItemRenderer),
      'continuationCommand',
    ).at(-1)?.token,
  };
}

function parseVideoRenderer(renderer: any): ListedVideo {
  const byline = renderer.shortBylineText?.runs?.[0];
  const views = renderer.shortViewCountText;
  const removal = findAll(
    findAll(renderer.menu, 'menuServiceItemRenderer').find(
      (item) => item.icon?.iconType === 'DELETE',
    ),
    'feedbackEndpoint',
  )[0];
  return {
    id: renderer.videoId,
    title: renderer.title?.runs?.map((run: any) => run.text).join('') ?? '',
    thumbnail:
      absoluteUrl(renderer.thumbnail?.thumbnails?.at(-1)?.url) ??
      `https://i.ytimg.com/vi/${renderer.videoId}/mqdefault.jpg`,
    duration: renderer.lengthText?.simpleText,
    channel: byline?.text && {
      title: byline.text,
      url: channelUrl(byline.navigationEndpoint?.browseEndpoint),
      avatar: absoluteUrl(
        findAll(renderer.channelThumbnailSupportedRenderers, 'thumbnails')[0]?.[0]?.url,
      ),
    },
    // Like the view count of a lockup: e.g. "1.9K" with "1.9K views" as label
    details: views?.simpleText
      ? [
          {
            text: views.simpleText,
            label: views.accessibility?.accessibilityData?.label,
            hasPlayIcon: true,
          },
        ]
      : [],
    progress: findAll(renderer.thumbnailOverlays, 'percentDurationWatched')[0],
    feedback: removal?.feedbackToken ? { removeFromHistory: { token: removal.feedbackToken } } : {},
  };
}

/** Unsubscribe from a channel. */
export async function unsubscribe(channel: Channel): Promise<void> {
  const { status } = await innertubeRequest('subscription/unsubscribe', {
    channelIds: [channel.id],
    ...(channel.unsubscribeParams && { params: channel.unsubscribeParams }),
  });
  if (status !== 200) throw new Error(`Unsubscribe failed (${status})`);
}

/** The logged-in account, read from YouTube's account menu; undefined when logged out. */
export async function fetchAccount(): Promise<Account | undefined> {
  try {
    const { status, data } = await innertubeRequest('account/account_menu', {});
    if (status !== 200) throw new Error(`Loading the account failed (${status})`);
    return parseAccountMenu(data);
  } catch (err) {
    if (err instanceof NotLoggedInError) return undefined;
    throw err;
  }
}

/** The account in the header of YouTube's account menu, which logged-out menus lack. */
export function parseAccountMenu(data: unknown): Account | undefined {
  const header = findAll(data, 'activeAccountHeaderRenderer')[0];
  if (!header) return undefined;
  const name =
    header.accountName?.simpleText ??
    header.accountName?.runs?.map((run: any) => run.text).join('');
  return {
    name: name ?? '',
    handle: header.channelHandle?.simpleText,
    avatar: absoluteUrl(header.accountPhoto?.thumbnails?.at(-1)?.url),
  };
}

/**
 * Sends a request to YouTube's internal API as the logged-in user, signed the
 * way YouTube's web client signs its own requests.
 */
async function innertubeRequest(
  endpoint: string,
  body: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<{ status: number; data: unknown }> {
  await sendAsYouTube();
  const result = await post(endpoint, body, await getClientConfig(), options);
  if (result.status !== 401 && result.status !== 403) return result;
  // A config read earlier may belong to an old session, e.g. after logging
  // in again, so try once more with a fresh one.
  clientConfig = undefined;
  return post(endpoint, body, await getClientConfig(), options);
}

interface RequestOptions {
  /** Language of the response (`hl`) in place of the user's, e.g. "en" */
  language?: string;
}

async function post(
  endpoint: string,
  body: Record<string, unknown>,
  config: ClientConfig,
  { language }: RequestOptions,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: await authorization(),
    'X-Goog-AuthUser': config.sessionIndex,
    'X-Origin': ORIGIN,
  };
  if (config.visitorData) headers['X-Goog-Visitor-Id'] = config.visitorData;
  if (config.clientName) headers['X-Youtube-Client-Name'] = config.clientName;
  if (config.clientVersion) headers['X-Youtube-Client-Version'] = config.clientVersion;
  const context = config.context as { client?: object };
  const res = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({
      context: language ? { ...context, client: { ...context.client, hl: language } } : context,
      ...body,
    }),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** The Authorization header of YouTube's web client, made from the login cookies. */
async function authorization(): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const parts: string[] = [];
  for (const [cookieName, scheme] of [
    ['SAPISID', 'SAPISIDHASH'],
    ['__Secure-1PAPISID', 'SAPISID1PHASH'],
    ['__Secure-3PAPISID', 'SAPISID3PHASH'],
  ] as const) {
    const cookie = await browser.cookies.get({ url: ORIGIN, name: cookieName });
    if (!cookie) continue;
    const digest = await crypto.subtle.digest(
      'SHA-1',
      new TextEncoder().encode(`${timestamp} ${cookie.value} ${ORIGIN}`),
    );
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    parts.push(`${scheme} ${timestamp}_${hash}`);
  }
  if (parts.length === 0) throw new NotLoggedInError();
  return parts.join(' ');
}

let originRule: Promise<void> | undefined;

/**
 * YouTube's API refuses requests from other sites (403), and the browser marks
 * this extension's requests as its own. Present them as youtube.com's own, for
 * this extension's requests to the API only.
 */
function sendAsYouTube(): Promise<void> {
  originRule ??= browser.declarativeNetRequest
    .updateSessionRules({
      // Rule 1 is the player's Referer rule.
      removeRuleIds: [2],
      addRules: [
        {
          id: 2,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: ORIGIN },
              { header: 'Referer', operation: 'set', value: `${ORIGIN}/` },
            ],
          },
          condition: {
            urlFilter: `|${ORIGIN}/youtubei/`,
            resourceTypes: ['xmlhttprequest'],
            initiatorDomains: [extensionHost()],
          },
        },
      ],
    })
    .catch((err) => {
      originRule = undefined;
      throw err;
    });
  return originRule;
}

/** The parts of YouTube's web client config (`ytcfg`) its API expects */
interface ClientConfig {
  context: unknown;
  sessionIndex: string;
  visitorData?: string;
  clientName?: string;
  clientVersion?: string;
}

let clientConfig: Promise<ClientConfig> | undefined;

function getClientConfig(): Promise<ClientConfig> {
  clientConfig ??= loadClientConfig().catch((err) => {
    clientConfig = undefined;
    throw err;
  });
  return clientConfig;
}

async function loadClientConfig(): Promise<ClientConfig> {
  const res = await fetch(ORIGIN, { credentials: 'include' });
  if (!res.ok) throw new Error(`Loading YouTube's client config failed (${res.status})`);
  const config = parseClientConfig(await res.text());
  if (!config) throw new Error("YouTube's client config not found");
  return config;
}

/** Keeps the config of a YouTube page that was loaded anyway, saving a request. */
function rememberClientConfig(html: string) {
  const config = parseClientConfig(html);
  if (config) clientConfig = Promise.resolve(config);
}

function parseClientConfig(html: string): ClientConfig | undefined {
  const config: Record<string, any> = {};
  for (const [, json] of html.matchAll(/ytcfg\.set\((\{.*?\})\);/gs)) {
    try {
      Object.assign(config, JSON.parse(json!));
    } catch {}
  }
  if (!config.INNERTUBE_CONTEXT) return undefined;
  return {
    context: config.INNERTUBE_CONTEXT,
    sessionIndex: String(config.SESSION_INDEX ?? 0),
    visitorData: config.VISITOR_DATA,
    clientName: config.INNERTUBE_CONTEXT_CLIENT_NAME?.toString(),
    clientVersion: config.INNERTUBE_CONTEXT_CLIENT_VERSION,
  };
}

/** The link to a channel, from the endpoint YouTube's own link to it has */
function channelUrl(browse: any): string | undefined {
  return (
    browse?.browseId &&
    new URL(browse.canonicalBaseUrl ?? `/channel/${browse.browseId}`, ORIGIN).href
  );
}

function absoluteUrl(url: string | undefined) {
  return url && new URL(url, 'https://www.youtube.com').href;
}

/** The page data YouTube embeds in its HTML pages. */
function initialData(html: string): unknown {
  const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  return json && JSON.parse(json);
}

function findAll(node: unknown, key: string, found: any[] = []): any[] {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) found.push(v);
      else findAll(v, key, found);
    }
  }
  return found;
}
