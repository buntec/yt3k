import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { episodeKey, getProgress, moveProgress, savePosition } from './progress';

const OLD = 'https://example.com/feed.xml';
const NEW = 'https://example.net/feed.xml';

describe('moveProgress', () => {
  afterEach(() => fakeBrowser.reset());

  it("moves a show's progress to its new feed, keeping what's there already", async () => {
    await savePosition(episodeKey(OLD, 'ep-1'), 120, 3600);
    await savePosition(episodeKey(OLD, 'ep-2'), 300, 3600);
    await savePosition(episodeKey(NEW, 'ep-2'), 900, 3600);
    await savePosition(episodeKey(`${OLD}?other`, 'ep-1'), 60, 3600);
    await moveProgress(OLD, NEW);

    expect((await getProgress(episodeKey(NEW, 'ep-1')))?.position).toBe(120);
    expect((await getProgress(episodeKey(NEW, 'ep-2')))?.position).toBe(900);
    expect(await getProgress(episodeKey(OLD, 'ep-1'))).toBeUndefined();
    // Another feed, though its address starts the same
    expect((await getProgress(episodeKey(`${OLD}?other`, 'ep-1')))?.position).toBe(60);
  });
});
