import { useMemo, useSyncExternalStore } from 'react';

/** The colors a group can have: those both Badge and Token come in. */
export const GROUP_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  name: string;
  color: GroupColor;
  /** Kept when a channel is unsubscribed from, so subscribing again restores it */
  channelIds: string[];
}

/**
 * Which channels the page shows: all, those in no group, or one group's, by
 * its ID.
 */
export type GroupFilter = 'all' | 'ungrouped' | (string & {});

// Extension storage like the subscriptions, unlike the display settings in
// localStorage: losing groups to cleared site data would lose real work.
const groupsItem = storage.defineItem<Group[]>('local:groups', { fallback: [] });

export interface GroupsState {
  /** Sorted by name, so the order is the same everywhere groups are listed */
  groups: Group[];
  isLoaded: boolean;
}

let state: GroupsState = { groups: [], isLoaded: false };
const listeners = new Set<() => void>();
let isLoading = false;
/** What this page stored and is yet to hear back about from storage */
const ownWrites = new Set<string>();

export function useGroups(): GroupsState {
  if (!isLoading) {
    isLoading = true;
    void groupsItem.getValue().then(publish);
    // Follow changes made in other tabs. Our own writes come back here too,
    // possibly after later ones were shown, which they mustn't undo.
    groupsItem.watch((value) => {
      if (!ownWrites.delete(JSON.stringify(value))) publish(value ?? []);
    });
  }
  return useSyncExternalStore(subscribe, () => state);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function publish(groups: Group[]) {
  state = { groups: [...groups].sort((a, b) => a.name.localeCompare(b.name)), isLoaded: true };
  for (const listener of listeners) listener();
}

function save(groups: Group[]) {
  publish(groups);
  ownWrites.add(JSON.stringify(state.groups));
  void groupsItem.setValue(state.groups);
}

/** Why a name can't be given to a group, if it can't */
export function nameProblem(name: string, exceptId?: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name';
  const taken = state.groups.some(
    (g) => g.id !== exceptId && g.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (taken) return 'A group with that name already exists';
}

/** The color used least so far, so new groups tell apart from the others */
export function unusedColor(): GroupColor {
  const uses = new Map(GROUP_COLORS.map((c) => [c, 0]));
  for (const g of state.groups) uses.set(g.color, uses.get(g.color)! + 1);
  return GROUP_COLORS.reduce((best, c) => (uses.get(c)! < uses.get(best)! ? c : best));
}

export function createGroup(name: string, color: GroupColor, channelIds: string[] = []): Group {
  const group = { id: crypto.randomUUID(), name: name.trim(), color, channelIds };
  save([...state.groups, group]);
  return group;
}

export function editGroup(id: string, changes: Pick<Group, 'name' | 'color'>) {
  save(
    state.groups.map((g) => (g.id === id ? { ...g, ...changes, name: changes.name.trim() } : g)),
  );
}

export function deleteGroup(id: string) {
  save(state.groups.filter((g) => g.id !== id));
}

/** Puts a deleted group back, e.g. on Undo. */
export function restoreGroup(group: Group) {
  save([...state.groups.filter((g) => g.id !== group.id), group]);
}

export function setInGroup(groupId: string, channelId: string, isIn: boolean) {
  save(
    state.groups.map((g) => {
      if (g.id !== groupId || g.channelIds.includes(channelId) === isIn) return g;
      const channelIds = isIn
        ? [...g.channelIds, channelId]
        : g.channelIds.filter((id) => id !== channelId);
      return { ...g, channelIds };
    }),
  );
}

/** Puts back the groups as they were, e.g. on Undo of an import. */
export function setGroups(groups: Group[]) {
  save(groups);
}

/** What a groups file holds: no IDs, which only mean something here */
interface GroupsFile {
  format: typeof FILE_FORMAT;
  groups: Omit<Group, 'id'>[];
}

const FILE_FORMAT = 'yt3k-groups-1';

/** The groups as JSON, to save to a file */
export function exportGroups(groups: Group[]): string {
  const file: GroupsFile = {
    format: FILE_FORMAT,
    groups: groups.map(({ name, color, channelIds }) => ({ name, color, channelIds })),
  };
  return JSON.stringify(file, null, 2);
}

/** The groups in a file saved by exportGroups. Throws if it isn't one. */
export function parseGroupsFile(text: string): Omit<Group, 'id'>[] {
  const file = JSON.parse(text) as Partial<GroupsFile> | null;
  if (file?.format !== FILE_FORMAT || !Array.isArray(file.groups)) {
    throw new Error('Not a groups file');
  }
  return file.groups.map((g) => {
    if (
      typeof g?.name !== 'string' ||
      !g.name.trim() ||
      !Array.isArray(g.channelIds) ||
      !g.channelIds.every((id) => typeof id === 'string')
    ) {
      throw new Error('Not a groups file');
    }
    return {
      name: g.name.trim(),
      // An unknown color, e.g. from a later version, shouldn't lose the group
      color: GROUP_COLORS.includes(g.color) ? g.color : 'blue',
      channelIds: [...new Set(g.channelIds)],
    };
  });
}

/**
 * The groups with the imported ones added. One with the name of an existing
 * group adds its channels to it and gives it its color, so importing a file
 * again changes nothing and no group is ever lost.
 */
export function mergeGroups(groups: Group[], imported: Omit<Group, 'id'>[]): Group[] {
  const merged = [...groups];
  for (const group of imported) {
    const i = merged.findIndex((g) => g.name.toLowerCase() === group.name.toLowerCase());
    if (i === -1) {
      merged.push({ ...group, id: crypto.randomUUID() });
    } else {
      const channelIds = [...new Set([...merged[i]!.channelIds, ...group.channelIds])];
      merged[i] = { ...merged[i]!, color: group.color, channelIds };
    }
  }
  return merged;
}

/** Adds the groups in a file saved by exportGroups. Throws if it isn't one. */
export function importGroups(text: string) {
  save(mergeGroups(state.groups, parseGroupsFile(text)));
}

// The filter is a display setting like the number of videos per channel: in
// localStorage, so the page has it on first render. Unlike the settings, it's
// read once rather than following other tabs, which can show other groups.
const FILTER_KEY = 'groupFilter';
let filter = storedFilter();
const filterListeners = new Set<() => void>();

/** The group filter last chosen */
export function useGroupFilter(): GroupFilter {
  return useSyncExternalStore(subscribeToFilter, () => filter);
}

export function setGroupFilter(value: GroupFilter) {
  filter = value;
  try {
    if (value === 'all') localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, value);
  } catch (err) {
    console.warn(err);
  }
  for (const listener of filterListeners) listener();
}

/**
 * The group filter last chosen, which Subs and Live share, and whether a
 * channel passes it. A group deleted meanwhile, e.g. in another tab, leaves
 * all channels shown.
 */
export function useChannelFilter() {
  const { groups, isLoaded } = useGroups();
  const stored = useGroupFilter();
  const group = groups.find((g) => g.id === stored);
  const filter: GroupFilter = stored === 'ungrouped' || group || !isLoaded ? stored : 'all';

  const includes = useMemo(() => {
    if (filter === 'all') return () => true;
    if (filter === 'ungrouped') {
      const grouped = new Set(groups.flatMap((g) => g.channelIds));
      return (channelId: string) => !grouped.has(channelId);
    }
    const ids = new Set(groups.find((g) => g.id === filter)?.channelIds);
    return (channelId: string) => ids.has(channelId);
  }, [filter, groups]);

  return { filter, group, includes };
}

function subscribeToFilter(onChange: () => void) {
  filterListeners.add(onChange);
  return () => filterListeners.delete(onChange);
}

function storedFilter(): GroupFilter {
  try {
    return localStorage.getItem(FILTER_KEY) ?? 'all';
  } catch {
    return 'all';
  }
}
