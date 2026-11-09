/** A podcast as its RSS feed describes it */
export interface PodcastFeed {
  title: string;
  author?: string;
  image?: string;
  /** The show's web page */
  link?: string;
  /**
   * Where the feed says it moved, as podcast hosts announce a move to
   * another: apps are to follow the show there. Many feeds name themselves.
   */
  newFeedUrl?: string;
  /** Newest first, at most MAX_EPISODES */
  episodes: Episode[];
}

export interface Episode {
  /** The feed's guid for it, else its media URL */
  id: string;
  title: string;
  /** ISO 8601 timestamp; missing if the feed's date can't be read */
  published?: string;
  mediaUrl: string;
  /** The media's type, as the feed tells it, e.g. "audio/mpeg" */
  mediaType?: string;
  /** Length in seconds, as the feed tells it */
  duration?: number;
  /** The episode's own artwork, if it has any */
  image?: string;
  /** The episode's web page */
  link?: string;
}

/**
 * How many of a show's episodes are kept, newest first. Feeds can list a
 * thousand, all stored in extension storage, and the page shows the recent ones.
 */
export const MAX_EPISODES = 100;

/** Thrown when a URL doesn't lead to a podcast feed */
export class NotAFeedError extends Error {}

/**
 * The URL as typed, cleaned up, e.g. with a missing https:// added and a
 * feed:// one replaced. Throws if it can't be a feed's URL.
 */
export function normalizeFeedUrl(input: string): string {
  let text = input.trim().replace(/^(feed|podcast|itpc|pcast):(\/\/)?/i, 'https://');
  if (!/^[a-z][a-z\d+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new NotAFeedError("That isn't a web address");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new NotAFeedError("That isn't a web address");
  }
  url.hash = '';
  return url.href;
}

/**
 * The address the show moved to, if its feed at `feedUrl` announced one that
 * isn't where it is already.
 */
export function movedFeedUrl(feedUrl: string, newFeedUrl: string | undefined) {
  if (!newFeedUrl) return undefined;
  try {
    const target = normalizeFeedUrl(newFeedUrl);
    return target === feedUrl ? undefined : target;
  } catch {
    return undefined;
  }
}

/** The match pattern of the site a feed is on, for the permission to read it */
export function feedOrigin(feedUrl: string): string {
  const { protocol, hostname } = new URL(feedUrl);
  return `${protocol}//${hostname}/*`;
}

/** What the site told of the feed last loaded, to ask whether it changed since */
export interface FeedValidators {
  etag?: string;
  lastModified?: string;
}

export type FeedResponse =
  | { feed: PodcastFeed; validators: FeedValidators }
  /** Unchanged since loaded with the validators given */
  | { feed?: undefined; validators: FeedValidators };

/**
 * Loads and reads a feed, unless it didn't change since it was loaded with
 * `validators`. Feeds can be megabytes, so asking saves loading and reading it.
 */
export async function fetchFeed(
  feedUrl: string,
  validators: FeedValidators = {},
): Promise<FeedResponse> {
  const headers = new Headers();
  if (validators.etag) headers.set('If-None-Match', validators.etag);
  if (validators.lastModified) headers.set('If-Modified-Since', validators.lastModified);
  let res: Response;
  try {
    // Past the browser's cache, which would answer an unchanged feed in full
    res = await fetch(feedUrl, { headers, cache: 'no-store', credentials: 'omit' });
  } catch (err) {
    // Offline, or the feed redirects to a site yt3k may not read
    throw new Error(`Couldn't load ${new URL(feedUrl).hostname}`, { cause: err });
  }
  if (res.status === 304) return { validators };
  if (!res.ok) throw new Error(`${new URL(feedUrl).hostname} answered ${res.status}`);
  const feed = parseFeed(await res.text());
  return {
    feed,
    validators: {
      ...(res.headers.get('ETag') && { etag: res.headers.get('ETag')! }),
      ...(res.headers.get('Last-Modified') && { lastModified: res.headers.get('Last-Modified')! }),
    },
  };
}

/** The podcast in an RSS feed. Throws NotAFeedError if it isn't one. */
export function parseFeed(xml: string): PodcastFeed {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const channel = doc.querySelector('parsererror') ? null : doc.querySelector('rss > channel');
  if (!channel) throw new NotAFeedError("That isn't a podcast feed");

  const seen = new Set<string>();
  const episodes = children(channel, 'item')
    .flatMap((item) => readEpisode(item) ?? [])
    // Some feeds list an episode twice, e.g. once more after editing it
    .filter((episode) => !seen.has(episode.id) && Boolean(seen.add(episode.id)))
    .sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
    .slice(0, MAX_EPISODES);
  return {
    title: text(channel, 'title') ?? 'Untitled podcast',
    author: text(channel, 'itunes:author'),
    image: attribute(channel, 'itunes:image', 'href') ?? text(child(channel, 'image'), 'url'),
    link: text(channel, 'link'),
    newFeedUrl: text(channel, 'itunes:new-feed-url'),
    episodes,
  };
}

function readEpisode(item: Element): Episode | undefined {
  const enclosure = child(item, 'enclosure');
  const mediaUrl = enclosure?.getAttribute('url')?.trim();
  // Without media, e.g. a post announcing the show, there's nothing to play
  if (!mediaUrl) return undefined;
  const pubDate = text(item, 'pubDate');
  const date = pubDate ? new Date(pubDate) : undefined;
  return {
    id: text(item, 'guid') ?? mediaUrl,
    title: text(item, 'title') ?? text(item, 'itunes:title') ?? 'Untitled episode',
    published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined,
    mediaUrl,
    mediaType: enclosure?.getAttribute('type')?.trim() || undefined,
    duration: parseDuration(text(item, 'itunes:duration')),
    image: attribute(item, 'itunes:image', 'href'),
    link: text(item, 'link'),
  };
}

/** Seconds in a duration like "5530", "92:10" or "01:32:10" */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value || !/^\d+(\.\d+)?(:\d+(\.\d+)?){0,2}$/.test(value)) return undefined;
  const seconds = value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? Math.round(seconds) : undefined;
}

// Elements are matched by their name as written, prefix included: not every
// DOM implementation of XML resolves namespaces, and feeds use the usual ones.

function children(parent: Element, name: string): Element[] {
  return [...parent.children].filter((el) => el.nodeName === name);
}

function child(parent: Element | undefined, name: string): Element | undefined {
  return parent && children(parent, name)[0];
}

function text(parent: Element | undefined, name: string): string | undefined {
  return child(parent, name)?.textContent?.trim() || undefined;
}

function attribute(parent: Element, name: string, attr: string): string | undefined {
  return child(parent, name)?.getAttribute(attr)?.trim() || undefined;
}
