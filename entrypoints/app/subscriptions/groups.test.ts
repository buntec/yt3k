import { describe, expect, it, vi } from 'vitest';
import {
  type Group,
  exportGroups,
  getSynced,
  mergeGroups,
  parseGroupsFile,
  stampChanges,
  updateSynced,
} from './groups';

const music: Group = { id: 'a', name: 'Music', color: 'red', channelIds: ['UC1', 'UC2'] };
const news: Group = { id: 'b', name: 'News', color: 'blue', channelIds: ['UC3'] };

describe('parseGroupsFile', () => {
  it('reads back what exportGroups saved, without IDs', () => {
    expect(parseGroupsFile(exportGroups([music, news]))).toEqual([
      { name: 'Music', color: 'red', channelIds: ['UC1', 'UC2'] },
      { name: 'News', color: 'blue', channelIds: ['UC3'] },
    ]);
  });

  it('rejects other JSON', () => {
    expect(() => parseGroupsFile('not json')).toThrow();
    expect(() => parseGroupsFile('null')).toThrow();
    expect(() => parseGroupsFile('{"groups": []}')).toThrow();
    expect(() =>
      parseGroupsFile('{"format": "yt3k-groups-1", "groups": [{"name": "", "channelIds": []}]}'),
    ).toThrow();
    expect(() =>
      parseGroupsFile('{"format": "yt3k-groups-1", "groups": [{"name": "A", "channelIds": [1]}]}'),
    ).toThrow();
  });

  it('keeps a group with an unknown color', () => {
    const text =
      '{"format": "yt3k-groups-1", "groups": [{"name": "A", "color": "gold", "channelIds": []}]}';
    expect(parseGroupsFile(text)).toEqual([{ name: 'A', color: 'blue', channelIds: [] }]);
  });
});

describe('mergeGroups', () => {
  it('adds new groups and channels to groups of the same name', () => {
    const merged = mergeGroups(
      [music, news],
      [
        { name: 'music', color: 'green', channelIds: ['UC2', 'UC4'] },
        { name: 'Games', color: 'purple', channelIds: ['UC5'] },
      ],
    );
    expect(merged).toEqual([
      { id: 'a', name: 'Music', color: 'green', channelIds: ['UC1', 'UC2', 'UC4'] },
      news,
      { id: expect.any(String), name: 'Games', color: 'purple', channelIds: ['UC5'] },
    ]);
  });

  it('changes nothing when importing the same groups again', () => {
    expect(mergeGroups([music, news], parseGroupsFile(exportGroups([music, news])))).toEqual([
      music,
      news,
    ]);
  });
});

describe('stampChanges', () => {
  const current = {
    groups: [
      { ...music, updatedAt: 1 },
      { ...news, updatedAt: 1 },
    ],
    deleted: {},
  };

  it('stamps changed and new groups, keeping the others', () => {
    const games: Group = { id: 'c', name: 'Games', color: 'purple', channelIds: [] };
    const next = stampChanges(current, [{ ...music, color: 'green' }, news, games], 5);
    expect(next.groups).toEqual([
      { ...music, color: 'green', updatedAt: 5 },
      { ...news, updatedAt: 1 },
      { ...games, updatedAt: 5 },
    ]);
    expect(next.deleted).toEqual({});
  });

  it('records deletions, and forgets them for groups put back', () => {
    const deleted = stampChanges(current, [music], 5);
    expect(deleted.deleted).toEqual({ b: 5 });
    const restored = stampChanges(deleted, [music, news], 6);
    expect(restored.deleted).toEqual({});
    expect(restored.groups[1]).toEqual({ ...news, updatedAt: 6 });
  });

  it('records the deletion of the groups a deleted group absorbed', () => {
    const absorbed = { z: { channelIds: ['UC4'], updatedAt: 1 } };
    const merged = { groups: [{ ...music, updatedAt: 2, absorbed }], deleted: { z: 1 } };
    expect(stampChanges(merged, [], 5).deleted).toEqual({ a: 5, z: 5 });
    // Put back, the groups it absorbed stay deleted: their channels are in it
    expect(stampChanges(stampChanges(merged, [], 5), merged.groups, 6).deleted).toEqual({ z: 5 });
  });

  it('stamps changes later than the copies they change, whatever the clock says', () => {
    // From a device whose clock is ahead, or before this one's went back
    const ahead = { groups: [{ ...music, updatedAt: 100 }], deleted: { b: 200 } };
    const edited = stampChanges(ahead, [{ ...music, color: 'green' }], 5);
    expect(edited.groups).toEqual([{ ...music, color: 'green', updatedAt: 101 }]);
    expect(stampChanges(ahead, [], 5).deleted).toEqual({ a: 100, b: 200 });
    const restored = stampChanges(ahead, [{ ...music, updatedAt: 100 }, news], 5);
    expect(restored.groups[1]).toEqual({ ...news, updatedAt: 201 });
  });
});

describe('groups in storage', () => {
  /** Lets storage report back the writes made so far */
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('follows changes from other tabs, even back to what it wrote itself', async () => {
    await getSynced();
    // Writing groups unchanged, as syncing does when only deletions differ
    await updateSynced((current) => current);
    await settle();
    // Another tab deletes a group, then puts it back
    await storage.setItem('local:groups', { groups: [music], deleted: {} });
    await settle();
    expect((await getSynced()).groups).toEqual([music]);
    await storage.setItem('local:groups', { groups: [], deleted: {} });
    await settle();
    expect((await getSynced()).groups).toEqual([]);
  });

  it('reads groups stored before sync', async () => {
    await storage.setItem('local:groups', [music]);
    vi.resetModules();
    const fresh = await import('./groups');
    expect(await fresh.getSynced()).toEqual({ groups: [music], deleted: {} });
  });
});
