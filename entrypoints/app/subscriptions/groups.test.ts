import { describe, expect, it } from 'vitest';
import { type Group, exportGroups, mergeGroups, parseGroupsFile } from './groups';

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
    const text = '{"format": "yt3k-groups-1", "groups": [{"name": "A", "color": "gold", "channelIds": []}]}';
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
