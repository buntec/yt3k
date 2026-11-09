import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applePodcastId,
  browserCountry,
  isAddress,
  parseDirectoryResults,
  searchDirectory,
} from './podcastDirectory';

/** A podcast as Apple's search and lookup APIs describe one, made up */
function result(overrides: Record<string, unknown> = {}) {
  return {
    wrapperType: 'track',
    kind: 'podcast',
    collectionId: 1,
    trackId: 1,
    artistName: 'Example Media',
    collectionName: 'Show & Tell',
    trackName: 'Show & Tell',
    feedUrl: 'https://example.com/feed.xml',
    artworkUrl100: 'https://images.example.com/100x100bb.jpg',
    artworkUrl600: 'https://images.example.com/600x600bb.jpg',
    trackCount: 42,
    primaryGenreName: 'News',
    ...overrides,
  };
}

describe('parseDirectoryResults', () => {
  it('reads the podcasts found', () => {
    expect(parseDirectoryResults({ resultCount: 1, results: [result()] })).toEqual([
      {
        feedUrl: 'https://example.com/feed.xml',
        title: 'Show & Tell',
        author: 'Example Media',
        image: 'https://images.example.com/600x600bb.jpg',
        episodeCount: 42,
        genre: 'News',
      },
    ]);
  });

  it("leaves out podcasts without a public feed and what isn't a podcast", () => {
    const results = [
      result({ feedUrl: undefined }),
      result({ feedUrl: '' }),
      result({ kind: 'podcast-episode' }),
      result({ collectionName: undefined, trackName: undefined }),
      null,
      result({ feedUrl: 'https://example.org/rss', artworkUrl600: undefined }),
    ];
    const found = parseDirectoryResults({ results });
    expect(found.map((p) => [p.feedUrl, p.image])).toEqual([
      ['https://example.org/rss', 'https://images.example.com/100x100bb.jpg'],
    ]);
  });

  it('reads nothing from responses it doesn’t know', () => {
    expect(parseDirectoryResults(null)).toEqual([]);
    expect(parseDirectoryResults({ errorMessage: 'Invalid value(s)' })).toEqual([]);
  });
});

describe('searchDirectory', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('searches podcasts in the country given', async () => {
    const fetch = vi.fn(async () => Response.json({ results: [result()] }));
    vi.stubGlobal('fetch', fetch);
    const found = await searchDirectory('show and tell', 'GB');
    const url = new URL((fetch.mock.calls[0] as unknown[])[0] as string);
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      term: 'show and tell',
      media: 'podcast',
      entity: 'podcast',
      country: 'GB',
    });
    expect(found).toHaveLength(1);
  });

  it('tells when the directory fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(searchDirectory('anything')).rejects.toThrow('answered 503');
  });
});

describe('applePodcastId', () => {
  it('reads the ID from Apple Podcasts links', () => {
    expect(applePodcastId('https://podcasts.apple.com/us/podcast/show-tell/id1234567890')).toBe(
      '1234567890',
    );
    expect(applePodcastId('podcasts.apple.com/gb/podcast/id42?i=1000')).toBe('42');
    expect(applePodcastId('https://itunes.apple.com/podcast/id7/')).toBe('7');
  });

  it('reads nothing from other addresses or words', () => {
    expect(applePodcastId('https://example.com/podcast/id123')).toBeUndefined();
    expect(applePodcastId('https://podcasts.apple.com/us/charts')).toBeUndefined();
    expect(applePodcastId('show and tell')).toBeUndefined();
  });
});

describe('isAddress', () => {
  it('tells addresses from words to search for', () => {
    expect(isAddress('https://example.com/feed.xml')).toBe(true);
    expect(isAddress('feed://example.com/rss')).toBe(true);
    expect(isAddress('example.com/feed')).toBe(true);
    expect(isAddress('  feeds.example.com  ')).toBe(true);
    expect(isAddress('show and tell')).toBe(false);
    expect(isAddress('Dr. Example')).toBe(false);
    expect(isAddress('99% Invisible')).toBe(false);
    expect(isAddress('history')).toBe(false);
  });
});

describe('browserCountry', () => {
  it('is the region of the first language that names one', () => {
    expect(browserCountry(['en-GB', 'en'])).toBe('GB');
    expect(browserCountry(['de', 'de-AT'])).toBe('AT');
    expect(browserCountry(['pt_br'])).toBe('BR');
    expect(browserCountry(['en'])).toBeUndefined();
    expect(browserCountry(['zh-Hans-CN'])).toBeUndefined();
  });
});
