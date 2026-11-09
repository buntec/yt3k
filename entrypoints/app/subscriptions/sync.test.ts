import { describe, expect, it } from 'vitest';
import { type Show, type SyncedShows, mergeShows } from '../podcasts/shows';
import { type Group, type Synced, stampChanges } from './groups';
import {
  NewerFormatError,
  type SyncData,
  mergeSynced,
  parseSyncData,
  sameSynced,
  sameSyncData,
  serializeSyncData,
} from './sync';

const NOW = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;
/** A time `n` ms after a day ago, recent enough for deletions to be kept */
const at = (n: number) => NOW - DAY + n;

const music: Group = {
  id: 'a',
  name: 'Music',
  color: 'red',
  channelIds: ['UC1'],
  updatedAt: at(10),
};
const news: Group = {
  id: 'b',
  name: 'News',
  color: 'blue',
  channelIds: ['UC3'],
  updatedAt: at(10),
};

function synced(groups: Group[], deleted: Synced['deleted'] = {}): Synced {
  return { groups, deleted };
}

/** Merged both ways, which must agree */
function merge(a: Synced, b: Synced): Synced {
  const ab = mergeSynced(a, b, NOW);
  expect(sameSynced(ab, mergeSynced(b, a, NOW))).toBe(true);
  return ab;
}

describe('mergeSynced', () => {
  it('keeps the groups of both', () => {
    expect(merge(synced([music]), synced([news])).groups).toEqual([music, news]);
  });

  it('keeps the copy of a group changed last', () => {
    const renamed = { ...music, name: 'Songs', updatedAt: at(20) };
    expect(merge(synced([music]), synced([renamed])).groups).toEqual([renamed]);
  });

  it('picks the same copy either way when both changed at once', () => {
    const green = { ...music, color: 'green' as const };
    merge(synced([music]), synced([green]));
  });

  it('drops a group deleted after it last changed', () => {
    expect(merge(synced([music, news]), synced([news], { a: at(20) }))).toEqual(
      synced([news], { a: at(20) }),
    );
  });

  it('keeps a group changed after it was deleted, e.g. put back', () => {
    const restored = { ...music, updatedAt: at(30) };
    expect(merge(synced([restored]), synced([], { a: at(20) })).groups).toEqual([restored]);
  });

  it('makes groups of the same name one, with the channels of both', () => {
    const other: Group = {
      id: 'z',
      name: 'music',
      color: 'green',
      channelIds: ['UC1', 'UC2'],
      updatedAt: at(15),
    };
    const merged = merge(synced([music]), synced([other]));
    expect(merged.groups).toEqual([
      {
        id: 'a',
        name: 'music',
        color: 'green',
        channelIds: ['UC1', 'UC2'],
        updatedAt: at(16),
        absorbed: { z: { channelIds: ['UC1', 'UC2'], updatedAt: at(15) } },
      },
    ]);
    expect(merged.deleted).toEqual({ z: at(15) });
    // A device that still has the other group drops it, and takes the merged one.
    expect(merge(merged, synced([other])).groups).toEqual(merged.groups);
  });

  describe('of groups of the same name', () => {
    const fromA: Group = { ...music, id: 'a', channelIds: ['A'], updatedAt: at(10) };
    const fromB: Group = { ...music, id: 'b', channelIds: ['B'], updatedAt: at(20) };
    const fromC: Group = { ...music, id: 'c', channelIds: ['C'], updatedAt: at(30) };
    const channels = (s: Synced) => s.groups.map((g) => [...g.channelIds].sort());

    it('keeps the channels of both in a copy changed before the merge reached it', () => {
      const merged = merge(synced([fromA]), synced([fromB]));
      // A changes its copy before syncing again, e.g. while offline
      const changed = synced([{ ...fromA, channelIds: ['A', 'X'], updatedAt: at(30) }]);
      const synced2 = merge(changed, merged);
      expect(channels(synced2)).toEqual([['A', 'B', 'X']]);
      // B, still holding its own copy, ends up with the same
      expect(merge(synced([fromB]), synced2)).toEqual(synced2);
    });

    it('keeps the channels of all when merged on two devices at once', () => {
      const ab = merge(synced([fromA]), synced([fromB]));
      const ac = merge(synced([fromA]), synced([fromC]));
      const all = merge(ab, ac);
      expect(channels(all)).toEqual([['A', 'B', 'C']]);
      // Each device syncing again changes nothing
      for (const device of [fromA, fromB, fromC]) {
        expect(merge(synced([device]), all)).toEqual(all);
      }
      expect(merge(ab, all)).toEqual(all);
      expect(merge(ac, all)).toEqual(all);
    });

    it('keeps the channels of all when overlapping pairs merged on two devices at once', () => {
      // One device merges A and B, keeping A; another B and C, keeping B, which
      // the first deleted. The second's B holds C's channels, which the first
      // never saw.
      const a = { ...fromA, updatedAt: at(100) };
      const b = { ...fromB, updatedAt: at(10) };
      const c = { ...fromC, updatedAt: at(50) };
      const ab = merge(synced([a]), synced([b]));
      const bc = merge(synced([b]), synced([c]));
      const all = merge(ab, bc);
      expect(channels(all)).toEqual([['A', 'B', 'C']]);
      // Each device syncing again changes nothing
      for (const device of [a, b, c]) {
        expect(merge(synced([device]), all)).toEqual(all);
      }
      expect(merge(ab, all)).toEqual(all);
      expect(merge(bc, all)).toEqual(all);
    });

    describe('when the group they became is deleted', () => {
      // A and B made one, as A; then a device that hasn't synced since
      // changes its B, and the one made of both is deleted
      const merged = merge(synced([fromA]), synced([fromB]));
      const deleted = stampChanges(merged, [], at(50));
      const changedB = (updatedAt: number) =>
        synced([{ ...fromB, channelIds: ['B', 'X'], updatedAt }]);

      it("doesn't bring it back from a copy changed before the deletion", () => {
        expect(merge(deleted, changedB(at(30))).groups).toEqual([]);
      });

      it('brings it back from a copy changed after the deletion', () => {
        expect(channels(merge(deleted, changedB(at(60))))).toEqual([['B', 'X']]);
      });

      it('keeps the channels of a copy changed before the deletion, once put back', () => {
        const restored = stampChanges(deleted, merged.groups, at(55));
        expect(channels(merge(restored, changedB(at(30))))).toEqual([['A', 'B', 'X']]);
      });
    });

    it('merges the same either way when copies tie but only one absorbed a group', () => {
      // One copy absorbed B and then dropped its channel; the other, changed at
      // the same moment to the same content, never absorbed B
      const absorbed = { b: { channelIds: ['B'], updatedAt: at(20) } };
      const withB: Group = { ...fromA, channelIds: ['A'], updatedAt: at(30), absorbed };
      const withoutB: Group = { ...fromA, channelIds: ['A'], updatedAt: at(30) };
      merge(synced([withB]), synced([withoutB]));
    });

    it("doesn't bring back channels removed after the merge", () => {
      const merged = merge(synced([fromA]), synced([fromB]));
      const removed = {
        ...merged,
        groups: [{ ...merged.groups[0]!, channelIds: ['A'], updatedAt: at(40) }],
      };
      expect(channels(merge(removed, merged))).toEqual([['A']]);
      expect(channels(merge(removed, synced([fromA, fromB])))).toEqual([['A']]);
    });
  });

  it('forgets deletions older than a year', () => {
    const old = NOW - 400 * DAY;
    const recent = NOW - DAY;
    expect(merge(synced([]), synced([], { a: old, b: recent })).deleted).toEqual({ b: recent });
  });

  it('treats groups from before sync as changed at the start of time', () => {
    const { updatedAt: _, ...unstamped } = music;
    expect(merge(synced([unstamped]), synced([], { a: at(1) })).groups).toEqual([]);
  });
});

const show: Show = { feedUrl: 'https://example.com/feed.xml', title: 'Show', updatedAt: at(10) };
const other: Show = {
  feedUrl: 'https://example.org/rss',
  title: 'Other',
  image: 'https://example.org/art.jpg',
  updatedAt: at(10),
};

function shows(list: Show[], deleted: SyncedShows['deleted'] = {}): SyncedShows {
  return { shows: list, deleted };
}

function data(groups: Synced, followed: SyncedShows = shows([])): SyncData {
  return { groups, shows: followed };
}

describe('parseSyncData', () => {
  it('reads back what serializeSyncData saved', () => {
    const value = data(synced([music, news], { c: at(5) }), shows([show, other], { x: at(3) }));
    expect(parseSyncData(serializeSyncData(value))).toEqual(value);
  });

  it('reads back the groups a group absorbed', () => {
    const absorbed = { b: { channelIds: ['UC2'], updatedAt: at(5) } };
    const value = data(synced([{ ...music, absorbed }]));
    expect(parseSyncData(serializeSyncData(value))).toEqual(value);
  });

  it("skips groups and podcasts it can't read and keeps the rest", () => {
    const text = JSON.stringify({
      format: 'yt3k-sync-2',
      groups: [music, { id: 'x', name: '', channelIds: [] }, { name: 'No ID', channelIds: [] }],
      deleted: { c: 5, d: 'soon' },
      podcasts: [show, { title: 'No feed', updatedAt: 1 }, { feedUrl: 'https://x', title: 'Undated' }],
      podcastsDeleted: { y: 7, z: null },
    });
    expect(parseSyncData(text)).toEqual(data(synced([music], { c: 5 }), shows([show], { y: 7 })));
  });

  it('reads files from before podcasts synced, as following none', () => {
    const text = JSON.stringify({ format: 'yt3k-sync-1', groups: [music], deleted: {} });
    expect(parseSyncData(text)).toEqual(data(synced([music])));
  });

  it('rejects other files, and tells a later format apart', () => {
    expect(() => parseSyncData('{}')).toThrow();
    expect(() => parseSyncData(JSON.stringify({ format: 'yt3k-groups-1', groups: [] }))).toThrow();
    expect(() => parseSyncData(JSON.stringify({ format: 'yt3k-sync-3', groups: [] }))).toThrow(
      NewerFormatError,
    );
  });
});

describe('mergeShows', () => {
  /** Merged both ways, which must agree */
  function mergeBoth(a: SyncedShows, b: SyncedShows): SyncedShows {
    const ab = mergeShows(a, b, NOW);
    expect(mergeShows(b, a, NOW)).toEqual(ab);
    return ab;
  }

  it('keeps the podcasts of both', () => {
    expect(mergeBoth(shows([show]), shows([other])).shows).toEqual([show, other]);
  });

  it('keeps the copy added last', () => {
    const renamed = { ...show, title: 'Renamed', updatedAt: at(20) };
    expect(mergeBoth(shows([show]), shows([renamed])).shows).toEqual([renamed]);
  });

  it('picks the same copy either way when both were added at once', () => {
    mergeBoth(shows([show]), shows([{ ...show, title: 'Same time' }]));
  });

  it('drops a podcast removed after it was added', () => {
    const merged = mergeBoth(shows([show, other]), shows([other], { [show.feedUrl]: at(15) }));
    expect(merged).toEqual(shows([other], { [show.feedUrl]: at(15) }));
  });

  it('keeps a podcast added again after it was removed', () => {
    const again = { ...show, updatedAt: at(20) };
    const merged = mergeBoth(shows([again]), shows([], { [show.feedUrl]: at(15) }));
    expect(merged.shows).toEqual([again]);
  });

  it('forgets removals older than a year', () => {
    const merged = mergeBoth(shows([]), shows([], { old: NOW - 400 * DAY, recent: at(1) }));
    expect(merged.deleted).toEqual({ recent: at(1) });
  });
});

describe('sameSyncData', () => {
  it('tells podcasts apart, whatever their order', () => {
    const groups = synced([music]);
    expect(sameSyncData(data(groups, shows([show, other])), data(groups, shows([other, show])))).toBe(
      true,
    );
    expect(sameSyncData(data(groups, shows([show])), data(groups, shows([other])))).toBe(false);
  });
});
