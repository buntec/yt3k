import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { FeedResponse } from '@/utils/podcast';

const A = 'https://a.example/feed.xml';
const B = 'https://b.example/feed.xml';

const fetchFeed = vi.fn<(url: string) => Promise<FeedResponse>>();
vi.mock('@/utils/podcast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/podcast')>()),
  fetchFeed: (url: string) => fetchFeed(url),
}));
// Reading OPML takes a DOMParser
vi.mock('@/utils/opml', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/opml')>()),
  parseOpml: (text: string) => JSON.parse(text),
}));

/** The sites yt3k may read feeds from */
let allowed: Set<string>;

function feed(title: string, newFeedUrl?: string): FeedResponse {
  return { feed: { title, newFeedUrl, episodes: [] }, validators: {} };
}

/** The store of the test running, whose refreshes it waits for after */
let store: typeof import('./store') | undefined;

/** The modules afresh, as a newly opened page has them */
async function load() {
  vi.resetModules();
  store = await import('./store');
  return { store, shows: await import('./shows') };
}

describe('the podcasts store', () => {
  beforeEach(() => {
    allowed = new Set();
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation(async ({ origins }) =>
      origins!.every((o) => allowed.has(o)),
    );
    fetchFeed.mockReset();
  });
  afterEach(async () => {
    // Waits for those still under way, e.g. started by an import
    await store?.refreshFeeds(false);
    store = undefined;
    vi.restoreAllMocks();
    fakeBrowser.reset();
  });

  it('loads the feeds the user allows while a refresh is under way', async () => {
    const { store, shows } = await load();
    allowed.add('https://a.example/*');
    let release!: () => void;
    fetchFeed.mockImplementation(async (url) => {
      if (url === A) await new Promise<void>((resolve) => (release = resolve));
      return feed(url);
    });
    vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation(async () => {
      allowed.add('https://b.example/*');
      return true;
    });
    await shows.addShows([
      { feedUrl: A, title: 'A' },
      { feedUrl: B, title: 'B' },
    ]);
    const refreshing = store.refreshFeeds(false);
    await vi.waitFor(() => expect(fetchFeed).toHaveBeenCalledWith(A));

    const allowing = store.allowReadingFeeds();
    await Promise.resolve();
    release();
    await Promise.all([refreshing, allowing]);
    expect(fetchFeed).toHaveBeenCalledWith(B);
  });

  it('undoes an import of a show that moved since', async () => {
    const { store, shows } = await load();
    allowed.add('https://a.example/*').add('https://b.example/*');
    fetchFeed.mockImplementation(async (url) => (url === A ? feed('A', B) : feed('B')));
    const result = await store.importPodcasts(JSON.stringify([{ feedUrl: A, title: 'A' }]));
    expect(result.added).toEqual([A]);
    // The refresh importing started, and the one after it loading the new feed
    await vi.waitFor(async () => {
      expect((await shows.getShows()).map((s) => s.feedUrl)).toEqual([B]);
      expect(fetchFeed).toHaveBeenCalledWith(B);
    });

    await store.undoImport(result);
    expect(await shows.getShows()).toEqual([]);
  });

  it("doesn't import a show again at the address it left", async () => {
    const { store, shows } = await load();
    await shows.updateSyncedShows(() => ({
      shows: [{ feedUrl: B, title: 'B', movedFrom: [A], updatedAt: 1 }],
      deleted: {},
    }));
    const result = await store.importPodcasts(JSON.stringify([{ feedUrl: A, title: 'A' }]));
    expect(result).toEqual({ added: [], alreadyFollowed: 1 });
  });
});
