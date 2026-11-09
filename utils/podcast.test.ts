// @vitest-environment jsdom
// For its DOMParser, which reads XML like browsers' do
import { describe, expect, it } from 'vitest';
// A made-up feed with the parts real ones have, and some they get wrong
import FEED from './__fixtures__/podcast-feed.xml?raw';
import {
  MAX_EPISODES,
  NotAFeedError,
  feedOrigin,
  movedFeedUrl,
  normalizeFeedUrl,
  parseDuration,
  parseFeed,
} from './podcast';

describe('parseFeed', () => {
  it('reads the show', () => {
    const { episodes, ...show } = parseFeed(FEED);
    expect(show).toEqual({
      title: 'Show & Tell',
      author: 'Example Media',
      image: 'https://example.com/art/show.jpg',
      link: 'https://example.com/show',
      newFeedUrl: 'https://feeds.example.net/show-and-tell.xml',
    });
  });

  it('reads the episodes with media, newest first, undated last', () => {
    expect(parseFeed(FEED).episodes).toEqual([
      {
        id: 'urn:example:episode-3',
        title: 'Episode 3: <Newest>',
        published: '2026-11-05T22:02:29.000Z',
        mediaUrl: 'http://media.example.com/3.mp3?feed=x&id=3',
        mediaType: 'audio/mpeg',
        duration: 1673,
        image: 'https://example.com/art/3.jpg',
        link: undefined,
      },
      {
        id: 'urn:example:episode-2',
        title: 'Episode 2: Older',
        published: '2026-11-02T21:49:59.000Z',
        mediaUrl: 'https://media.example.com/2.mp3',
        mediaType: 'audio/mpeg',
        duration: 5550,
        image: undefined,
        link: 'https://example.com/show/2',
      },
      {
        id: 'urn:example:video',
        title: 'Bonus: video',
        published: '2026-10-31T19:30:04.000Z',
        mediaUrl: 'https://media.example.com/bonus.mp4',
        mediaType: 'video/mp4',
        duration: undefined,
        image: undefined,
        link: undefined,
      },
      {
        id: 'https://media.example.com/1.m4a',
        title: 'Episode 1: No guid, no title, an odd date',
        published: undefined,
        mediaUrl: 'https://media.example.com/1.m4a',
        mediaType: 'audio/x-m4a',
        duration: 5530,
        image: undefined,
        link: undefined,
      },
    ]);
  });

  it('falls back to the RSS image for the show', () => {
    const feed = FEED.replace(/<itunes:image href="[^"]*show.jpg"\/>/, '');
    expect(parseFeed(feed).image).toBe('https://example.com/art/fallback.jpg');
  });

  it(`keeps the newest ${MAX_EPISODES} episodes`, () => {
    const items = Array.from(
      { length: MAX_EPISODES + 5 },
      (_, i) =>
        `<item><guid>${i}</guid><pubDate>${new Date(Date.UTC(2026, 0, 1 + i)).toUTCString()}</pubDate>` +
        `<enclosure url="https://media.example.com/${i}.mp3"/></item>`,
    );
    const { episodes } = parseFeed(`<rss><channel><title>Many</title>${items.join('')}</channel></rss>`);
    expect(episodes).toHaveLength(MAX_EPISODES);
    expect(episodes[0]!.id).toBe(String(MAX_EPISODES + 4));
  });

  it('lists an episode the feed lists twice once', () => {
    const item = '<item><guid>same</guid><enclosure url="https://media.example.com/a.mp3"/></item>';
    const { episodes } = parseFeed(`<rss><channel><title>Twice</title>${item}${item}</channel></rss>`);
    expect(episodes.map((e) => e.id)).toEqual(['same']);
  });

  it("rejects what isn't an RSS feed", () => {
    expect(() => parseFeed('<html><body>Not a feed</body></html>')).toThrow(NotAFeedError);
    expect(() => parseFeed('<rss><channel><title>Cut short')).toThrow(NotAFeedError);
    expect(() => parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toThrow(
      NotAFeedError,
    );
  });
});

describe('parseDuration', () => {
  it('reads seconds, minutes and hours', () => {
    expect(parseDuration('1673')).toBe(1673);
    expect(parseDuration('92:10')).toBe(5530);
    expect(parseDuration('01:32:30')).toBe(5550);
    expect(parseDuration('00:31:14.5')).toBe(1875);
  });

  it('leaves out what it cannot read', () => {
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration('')).toBeUndefined();
    expect(parseDuration('about an hour')).toBeUndefined();
    expect(parseDuration('0')).toBeUndefined();
  });
});

describe('normalizeFeedUrl', () => {
  it('cleans up what was typed or pasted', () => {
    expect(normalizeFeedUrl('  https://example.com/feed.xml ')).toBe('https://example.com/feed.xml');
    expect(normalizeFeedUrl('example.com/feed')).toBe('https://example.com/feed');
    expect(normalizeFeedUrl('feed://example.com/rss')).toBe('https://example.com/rss');
    expect(normalizeFeedUrl('podcast://example.com/rss')).toBe('https://example.com/rss');
    expect(normalizeFeedUrl('http://example.com/rss#top')).toBe('http://example.com/rss');
  });

  it("rejects what can't be a feed's address", () => {
    expect(() => normalizeFeedUrl('')).toThrow(NotAFeedError);
    expect(() => normalizeFeedUrl('ftp://example.com/feed')).toThrow(NotAFeedError);
    expect(() => normalizeFeedUrl('javascript:alert(1)')).toThrow(NotAFeedError);
  });
});

describe('movedFeedUrl', () => {
  const here = 'https://example.com/feed.xml';

  it('is the address a feed announced it moved to', () => {
    expect(movedFeedUrl(here, ' https://feeds.example.net/new.xml ')).toBe(
      'https://feeds.example.net/new.xml',
    );
  });

  it("is nothing for a feed naming itself, as many do, or an address that can't be one", () => {
    expect(movedFeedUrl(here, undefined)).toBeUndefined();
    expect(movedFeedUrl(here, here)).toBeUndefined();
    expect(movedFeedUrl(here, 'example.com/feed.xml')).toBeUndefined();
    expect(movedFeedUrl(here, 'ftp://example.com/feed.xml')).toBeUndefined();
  });
});

describe('feedOrigin', () => {
  it('is the match pattern of the feed’s site', () => {
    expect(feedOrigin('https://feeds.example.com:8443/a/b.xml?x=1')).toBe(
      'https://feeds.example.com/*',
    );
    expect(feedOrigin('http://example.com/rss')).toBe('http://example.com/*');
  });
});
