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
  /**
   * When the group was created or last changed, in ms since the epoch, which
   * decides whose copy wins when syncing. Missing for groups not changed since
   * before sync existed.
   */
  updatedAt?: number;
  /**
   * The groups of the same name, by ID, that syncing made part of this one, as
   * they were then. A copy of this group changed without knowing of one gets
   * that one's channels when syncing, rather than losing them.
   */
  absorbed?: Record<string, AbsorbedGroup>;
}

/** A group made part of another of the same name, as it was then */
export interface AbsorbedGroup {
  channelIds: string[];
  /** When it was last changed before, in ms since the epoch */
  updatedAt: number;
}

/**
 * The IDs of deleted groups, each with when it was deleted, so syncing removes
 * them from other devices rather than bringing them back from there.
 */
export type Deletions = Record<string, number>;

/** What syncing merges between devices: the groups and the deletions */
export interface Synced {
  groups: Group[];
  deleted: Deletions;
}

/**
 * Which channels the page shows: all, those in no group, or one group's, by
 * its ID.
 */
export type GroupFilter = 'all' | 'ungrouped' | (string & {});

// Extension storage like the subscriptions, unlike the display settings in
// localStorage: losing groups to cleared site data would lose real work.
// Groups and deletions are one item, so they always change together: a page
// writing one with the other out of date would lose a change made elsewhere.
const groupsItem = storage.defineItem<StoredGroups>('local:groups', {
  fallback: { groups: [], deleted: {} },
  version: 2,
  // Before sync, just the groups
  migrations: { 2: (groups: Group[]): StoredGroups => ({ groups, deleted: {} }) },
});

/** The groups and deletions as stored */
interface StoredGroups extends Synced {
  /**
   * The page that stored them, and its count of writes then, so it can tell
   * its own writes when storage reports them back. Every write differs by it,
   * so storage reports back each, even one changing nothing else.
   */
  writer?: { page: string; write: number };
}

/** How long a deletion is kept: a device away longer brings the group back */
const DELETION_TTL = 365 * 24 * 60 * 60 * 1000;

export interface GroupsState {
  /** Sorted by name, so the order is the same everywhere groups are listed */
  groups: Group[];
  isLoaded: boolean;
}

let state: GroupsState = { groups: [], isLoaded: false };
let deleted: Deletions = {};
const listeners = new Set<() => void>();
const saveListeners = new Set<() => void>();
let loading: Promise<void> | undefined;
/** This page, among those writing groups */
const page = crypto.randomUUID();
let writes = 0;
/** This page's writes that storage is yet to report back */
const pending = new Set<number>();

export function useGroups(): GroupsState {
  void load();
  return useSyncExternalStore(subscribe, () => state);
}

function load(): Promise<void> {
  loading ??= (async () => {
    // Follow changes made in other tabs. Storage reports writes in the order
    // it makes them, ours too, which are shown already.
    groupsItem.watch((value) => {
      if (value.writer?.page === page) {
        for (const write of pending) if (write <= value.writer.write) pending.delete(write);
        return;
      }
      // Made before a write of ours still to come, which replaces it
      if (pending.size) return;
      show(value);
    });
    const stored = await groupsItem.getValue();
    // Unless a change reported meanwhile showed later ones
    if (!state.isLoaded) show(stored);
  })();
  return loading;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function show(stored: StoredGroups | Group[]) {
  // Just the groups, as stored before sync, e.g. by a page of an earlier
  // version still open
  if (Array.isArray(stored)) stored = { groups: stored, deleted: {} };
  deleted = stored.deleted;
  publish(stored.groups);
}

function publish(groups: Group[]) {
  state = { groups: [...groups].sort((a, b) => a.name.localeCompare(b.name)), isLoaded: true };
  for (const listener of listeners) listener();
}

function save(groups: Group[]) {
  write(stampChanges({ groups: state.groups, deleted }, groups, Date.now()));
  for (const listener of saveListeners) listener();
}

function write(next: Synced) {
  deleted = next.deleted;
  publish(next.groups);
  const write = ++writes;
  pending.add(write);
  groupsItem
    .setValue({ groups: state.groups, deleted, writer: { page, write } })
    .catch(async (err) => {
      console.warn(err);
      pending.delete(write);
      // Show what's stored instead, which changes from other tabs held back
      // for this write may have changed
      if (pending.size) return;
      const stored = await groupsItem.getValue();
      if (!pending.size) show(stored);
    });
}

/**
 * The groups as `next` has them, those changed or added since `current`
 * stamped with `now`, and the deletions with those of the groups `next`
 * dropped added and those it brought back removed.
 *
 * A change is stamped later than the copy it changes even if `now` isn't, as
 * when that copy came from a device whose clock is ahead, or the clock here
 * went back: otherwise syncing would undo it.
 */
export function stampChanges(current: Synced, next: Group[], now: number): Synced {
  const before = new Map(current.groups.map((g) => [g.id, g]));
  const groups = next.map((group) => {
    const old = before.get(group.id);
    if (old && sameContent(old, group)) return { ...group, updatedAt: old.updatedAt };
    // Kept by a later sync only if changed after it was deleted, or after
    // the copy it replaces
    const after = Math.max(old?.updatedAt ?? -1, current.deleted[group.id] ?? -1);
    return { ...group, updatedAt: Math.max(now, after + 1) };
  });
  const deletions = { ...current.deleted };
  for (const group of next) delete deletions[group.id];
  for (const [id, old] of before) {
    if (next.some((g) => g.id === id)) continue;
    // Deleted by a later sync only if deleted no earlier than last changed
    const at = Math.max(now, old.updatedAt ?? 0);
    deletions[id] = at;
    // With the groups it absorbed, whose copies changed before syncing told
    // of it would otherwise bring it back. Put back, it gets their changes.
    for (const absorbedId of Object.keys(old.absorbed ?? {})) {
      if (next.some((g) => g.id === absorbedId)) continue;
      deletions[absorbedId] = Math.max(deletions[absorbedId] ?? 0, at);
    }
  }
  return { groups, deleted: pruneDeletions(deletions, now) };
}

function sameContent(a: Group, b: Group): boolean {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.channelIds.length === b.channelIds.length &&
    a.channelIds.every((id, i) => id === b.channelIds[i])
  );
}

/** The deletions without those too old to keep */
export function pruneDeletions(deletions: Deletions, now: number): Deletions {
  return Object.fromEntries(Object.entries(deletions).filter(([, at]) => now - at < DELETION_TTL));
}

/** The groups and deletions, once loaded, for syncing */
export async function getSynced(): Promise<Synced> {
  await load();
  return { groups: state.groups, deleted };
}

/**
 * Replaces the groups and deletions with what `update` makes of the current
 * ones, as they are: unlike edits here, what syncing brings isn't a change to
 * stamp or to sync back.
 */
export async function updateSynced(update: (current: Synced) => Synced) {
  await load();
  write(update({ groups: state.groups, deleted }));
}

/** Calls `listener` after each change made here, e.g. to sync it. */
export function onGroupsChanged(listener: () => void): () => void {
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
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
    const group = readGroup(g);
    if (!group) throw new Error('Not a groups file');
    return group;
  });
}

/**
 * The name, color and channels of a group read from a file, cleaned up, or
 * undefined if it isn't a group.
 */
export function readGroup(
  value: unknown,
): Pick<Group, 'name' | 'color' | 'channelIds'> | undefined {
  const g = value as Partial<Group> | null;
  if (
    typeof g?.name !== 'string' ||
    !g.name.trim() ||
    !Array.isArray(g.channelIds) ||
    !g.channelIds.every((id) => typeof id === 'string')
  ) {
    return undefined;
  }
  return {
    name: g.name.trim(),
    // An unknown color, e.g. from a later version, shouldn't lose the group
    color: GROUP_COLORS.includes(g.color!) ? g.color! : 'blue',
    channelIds: [...new Set(g.channelIds)],
  };
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
