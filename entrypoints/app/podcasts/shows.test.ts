import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addShows, getSyncedShows, removeShows } from './shows';

const a = { feedUrl: 'https://example.com/a.xml', title: 'A' };
const b = { feedUrl: 'https://example.com/b.xml', title: 'B' };

describe('following and unfollowing shows', () => {
  afterEach(() => {
    vi.useRealTimers();
    // Each change reads the stored shows first, so this starts the next test afresh
    fakeBrowser.reset();
  });

  it('follows several at once, each once', async () => {
    await addShows([a, b, a]);
    await addShows([b]);
    expect((await getSyncedShows()).shows.map((s) => s.feedUrl)).toEqual([a.feedUrl, b.feedUrl]);
  });

  it('remembers removals, so syncing removes them elsewhere too', async () => {
    vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
    await addShows([a, b]);
    vi.setSystemTime(2000);
    await removeShows([a.feedUrl]);
    const { shows, deleted } = await getSyncedShows();
    expect(shows.map((s) => s.feedUrl)).toEqual([b.feedUrl]);
    expect(deleted[a.feedUrl]).toBe(2000);
  });

  it('follows a show again after its removal, even with a clock behind', async () => {
    vi.useFakeTimers({ now: 5000, toFake: ['Date'] });
    await addShows([a]);
    await removeShows([a.feedUrl]);
    // E.g. the clock set back, or the removal synced from a device ahead
    vi.setSystemTime(3000);
    await addShows([a]);
    const { shows, deleted } = await getSyncedShows();
    expect(shows.map((s) => [s.feedUrl, s.updatedAt])).toEqual([[a.feedUrl, 5001]]);
    expect(deleted[a.feedUrl]).toBeUndefined();
  });
});
