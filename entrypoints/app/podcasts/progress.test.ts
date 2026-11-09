import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeKey, getProgress, moveProgress, savePosition } from './progress';
import { type Show, updateSyncedShows } from './shows';

const OLD = 'https://example.com/feed.xml';
const NEW = 'https://example.net/feed.xml';

/** Follows only these shows, as if synced */
function follow(...shows: Omit<Show, 'updatedAt'>[]) {
  return updateSyncedShows(() => ({
    shows: shows.map((s) => ({ ...s, updatedAt: 1 })),
    deleted: {},
  }));
}

/** The keys of the progress stored */
async function storedKeys() {
  const stored = await fakeBrowser.storage.local.get<{ podcastProgress: object }>(
    'podcastProgress',
  );
  return Object.keys(stored.podcastProgress).sort();
}

describe('progress', () => {
  beforeEach(() => follow());
  afterEach(() => {
    vi.useRealTimers();
    fakeBrowser.reset();
  });

  it("moves a show's progress to its new feed, keeping the newest", async () => {
    vi.useFakeTimers({ now: 1000, toFake: ['Date'] });
    await savePosition(episodeKey(OLD, 'ep-1'), 120, 3600);
    await savePosition(episodeKey(OLD, 'ep-2'), 300, 3600);
    await savePosition(episodeKey(NEW, 'ep-3'), 500, 3600);
    await savePosition(episodeKey(`${OLD}?other`, 'ep-1'), 60, 3600);
    vi.setSystemTime(2000);
    await savePosition(episodeKey(NEW, 'ep-2'), 900, 3600);
    await savePosition(episodeKey(OLD, 'ep-3'), 700, 3600);
    await moveProgress([[OLD, NEW]]);

    expect((await getProgress(episodeKey(NEW, 'ep-1')))?.position).toBe(120);
    expect((await getProgress(episodeKey(NEW, 'ep-2')))?.position).toBe(900);
    expect((await getProgress(episodeKey(NEW, 'ep-3')))?.position).toBe(700);
    expect(await getProgress(episodeKey(OLD, 'ep-1'))).toBeUndefined();
    // Another feed, though its address starts the same
    expect((await getProgress(episodeKey(`${OLD}?other`, 'ep-1')))?.position).toBe(60);
  });

  it('moves the progress of a show that moved in another browser', async () => {
    await savePosition(episodeKey(OLD, 'ep'), 120, 3600);
    await follow({ feedUrl: NEW, title: 'Moved', movedFrom: [OLD] });
    await moveProgress();
    expect((await getProgress(episodeKey(NEW, 'ep')))?.position).toBe(120);
    expect(await storedKeys()).toEqual([episodeKey(NEW, 'ep')]);
  });

  it('saves an episode played from the old address at the new one', async () => {
    await savePosition(episodeKey(OLD, 'ep'), 120, 3600);
    await follow({ feedUrl: NEW, title: 'Moved', movedFrom: [OLD] });
    await moveProgress();
    // The player still playing it, under its old key
    await savePosition(episodeKey(OLD, 'ep'), 240, 3600);
    expect((await getProgress(episodeKey(NEW, 'ep')))?.position).toBe(240);
    expect((await getProgress(episodeKey(OLD, 'ep')))?.position).toBe(240);
    expect(await storedKeys()).toEqual([episodeKey(NEW, 'ep')]);
  });

  it("keeps the old address's progress once that's followed again", async () => {
    await follow({ feedUrl: NEW, title: 'Moved', movedFrom: [OLD] }, { feedUrl: OLD, title: 'Old' });
    await savePosition(episodeKey(OLD, 'ep'), 120, 3600);
    await moveProgress();
    expect((await getProgress(episodeKey(OLD, 'ep')))?.position).toBe(120);
    expect(await getProgress(episodeKey(NEW, 'ep'))).toBeUndefined();
  });

  it("doesn't lose progress saved by two tabs at once", async () => {
    vi.resetModules();
    const one = await import('./progress');
    vi.resetModules();
    const other = await import('./progress');
    await Promise.all([one.getProgress('x'), other.getProgress('x')]);
    await Promise.all([
      one.savePosition(episodeKey(OLD, 'a'), 120, 3600),
      other.savePosition(episodeKey(OLD, 'b'), 240, 3600),
    ]);
    expect(await storedKeys()).toEqual([
      episodeKey(OLD, 'a'),
      episodeKey(OLD, 'b'),
    ]);
  });
});
