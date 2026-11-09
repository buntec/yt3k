import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addShows, getSyncedShows, moveShow, removeShows } from './shows';

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

  it('moves a show to its new address, leaving the old one removed', async () => {
    vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
    await addShows([a, b]);
    vi.setSystemTime(2000);
    const moved = { feedUrl: 'https://example.net/a.xml', title: 'A, moved' };
    await moveShow(a.feedUrl, moved);
    const { shows, deleted } = await getSyncedShows();
    expect(shows.map((s) => [s.feedUrl, s.title, s.updatedAt])).toEqual([
      [moved.feedUrl, 'A, moved', 2000],
      [b.feedUrl, 'B', 1000],
    ]);
    expect(deleted).toEqual({ [a.feedUrl]: 2000 });
  });

  it('moves a show to an address followed already by just leaving the old one', async () => {
    await addShows([a, b]);
    await moveShow(a.feedUrl, { feedUrl: b.feedUrl, title: 'Ignored' });
    const { shows } = await getSyncedShows();
    expect(shows.map((s) => [s.feedUrl, s.title])).toEqual([[b.feedUrl, 'B']]);
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
