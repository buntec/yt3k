import {
  type SyncedShows,
  canonicalShows,
  mergeShows,
  readShows,
} from '../podcasts/shows';
import {
  type AbsorbedGroup,
  type Deletions,
  type Group,
  type Synced,
  pruneDeletions,
  readGroup,
} from '../subscriptions/groups';

/*
 * How groups, and the podcasts followed, merge between devices. Each device keeps all groups and syncs by
 * merging its copy with the stored one, so a change lost to a device writing
 * at the same time is put back by the next sync of the device that made it.
 */

const FORMAT_PREFIX = 'yt3k-sync-';
// Version 2 adds the podcasts. Version 1 files, which have none, still read.
const FORMAT_VERSION = 2;

/** The synced data saved by a later version of yt3k, which this one can't read */
export class NewerFormatError extends Error {}

/** Everything synced: the groups and the podcasts followed */
export interface SyncData {
  groups: Synced;
  shows: SyncedShows;
}

/** What's stored where devices sync: all of each group, IDs included */
interface SyncFile {
  format: string;
  groups: Group[];
  deleted: Deletions;
  podcasts: SyncedShows['shows'];
  /** When each podcast removed was, by feed URL */
  podcastsDeleted: Deletions;
}

/** Everything synced, as the file stored for syncing */
export function serializeSyncData(data: SyncData): string {
  const groups = canonical(data.groups);
  const shows = canonicalShows(data.shows);
  const file: SyncFile = {
    format: FORMAT_PREFIX + FORMAT_VERSION,
    ...groups,
    podcasts: shows.shows,
    podcastsDeleted: shows.deleted,
  };
  return JSON.stringify(file);
}

/** Everything synced in a file saved by serializeSyncData. Throws if it isn't one. */
export function parseSyncData(text: string): SyncData {
  const file = JSON.parse(text) as Partial<SyncFile> | null;
  const version = file?.format?.startsWith(FORMAT_PREFIX)
    ? Number(file.format.slice(FORMAT_PREFIX.length))
    : NaN;
  if (version > FORMAT_VERSION) throw new NewerFormatError(file!.format);
  if (!(version >= 1) || !Number.isInteger(version) || !Array.isArray(file!.groups)) {
    throw new Error('Not a sync file');
  }
  const groups = file!.groups.flatMap((g): Group[] => {
    const group = readGroup(g);
    if (!group || typeof g.id !== 'string' || !g.id) return [];
    const absorbed = readAbsorbed(g.absorbed);
    return [
      {
        id: g.id,
        ...group,
        updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : 0,
        ...(absorbed && { absorbed }),
      },
    ];
  });
  const deleted = Object.fromEntries(
    Object.entries(file!.deleted ?? {}).filter(([, at]) => typeof at === 'number'),
  );
  return { groups: { groups, deleted }, shows: readShows(file!.podcasts, file!.podcastsDeleted) };
}

/** Both merged, the groups and the podcasts each their own way */
export function mergeSyncData(a: SyncData, b: SyncData, now: number): SyncData {
  return {
    groups: mergeSynced(a.groups, b.groups, now),
    shows: mergeShows(a.shows, b.shows, now),
  };
}

/** Whether both hold the same, whatever their order */
export function sameSyncData(a: SyncData, b: SyncData): boolean {
  return (
    sameSynced(a.groups, b.groups) &&
    JSON.stringify(canonicalShows(a.shows)) === JSON.stringify(canonicalShows(b.shows))
  );
}

function readAbsorbed(value: unknown): Group['absorbed'] {
  if (typeof value !== 'object' || !value) return undefined;
  const entries = Object.entries(value as Record<string, Partial<AbsorbedGroup> | null>).flatMap(
    ([id, g]): [string, AbsorbedGroup][] =>
      Array.isArray(g?.channelIds) &&
      g.channelIds.every((c) => typeof c === 'string') &&
      typeof g.updatedAt === 'number'
        ? [[id, { channelIds: g.channelIds, updatedAt: g.updatedAt }]]
        : [],
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Whether both hold the same groups and deletions, whatever their order */
export function sameSynced(a: Synced, b: Synced): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** In an order that only depends on the content, so equal content compares equal */
function canonical({ groups, deleted }: Synced): Synced {
  return {
    groups: [...groups]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map(({ id, name, color, channelIds, updatedAt, absorbed }) => ({
        id,
        name,
        color,
        channelIds,
        updatedAt: updatedAt ?? 0,
        ...(absorbed && {
          absorbed: Object.fromEntries(
            Object.entries(absorbed)
              .sort(([x], [y]) => (x < y ? -1 : 1))
              .map(([gid, g]) => [gid, { channelIds: g.channelIds, updatedAt: g.updatedAt }]),
          ),
        }),
      })),
    deleted: Object.fromEntries(Object.entries(deleted).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

/**
 * Both merged: of a group in both, the copy changed last, with the channels of
 * groups the other copy absorbed that it didn't know of; no group deleted
 * after it last changed, though one deleted by being absorbed lives on in the
 * one that absorbed it; and groups of the same name, as made on two devices
 * before they synced, as one. Merging in either order gives the same.
 */
export function mergeSynced(a: Synced, b: Synced, now: number): Synced {
  const deleted: Deletions = { ...a.deleted };
  for (const [id, at] of Object.entries(b.deleted)) deleted[id] = Math.max(deleted[id] ?? 0, at);

  const byId = new Map<string, Group>();
  for (const group of [...a.groups, ...b.groups]) {
    const other = byId.get(group.id);
    byId.set(group.id, other ? mergeCopies(group, other) : group);
  }

  const copies = [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  const isLive = (g: Group) => (deleted[g.id] ?? -1) < (g.updatedAt ?? 0);
  const gone = new Map(copies.filter((g) => !isLive(g)).map((g) => [g.id, g]));
  const live = copies.filter(isLive).map((g) => withGone(g, gone));

  const byName = new Map<string, Group>();
  for (const group of live) {
    const key = group.name.toLowerCase();
    const kept = byName.get(key);
    if (!kept) {
      byName.set(key, group);
      continue;
    }
    // Keep the one with the lower ID, with the channels of both and the name
    // and color of the one changed last. Being newer than both, it wins over
    // either elsewhere, and the other is deleted there. Recording the other as
    // absorbed keeps its channels in copies of the kept one changed elsewhere
    // before this merge reached them, which win over this one.
    const newer = isNewer(group, kept) ? group : kept;
    const updatedAt = Math.max(kept.updatedAt ?? 0, group.updatedAt ?? 0);
    const absorbed = mergeAbsorbed(mergeAbsorbed(kept.absorbed, group.absorbed), {
      [group.id]: { channelIds: group.channelIds, updatedAt: group.updatedAt ?? 0 },
    });
    byName.set(key, {
      id: kept.id,
      name: newer.name,
      color: newer.color,
      channelIds: [...new Set([...kept.channelIds, ...group.channelIds])],
      updatedAt: updatedAt + 1,
      ...(absorbed && { absorbed }),
    });
    deleted[group.id] = Math.max(deleted[group.id] ?? 0, updatedAt);
  }

  return { groups: [...byName.values()], deleted: pruneDeletions(deleted, now) };
}

/**
 * The group with the copies of the groups it absorbed that are deleted, as
 * ones it absorbed: they were deleted by being absorbed, maybe by it on
 * another device, so changes to them it didn't know of belong to it. E.g. B
 * absorbed C on one device while A absorbed B on another: A gets C's channels
 * from the copy of B that has them, though that B is deleted.
 *
 * Deletions don't tell being absorbed from being deleted by the user, so B
 * deleted on a device that didn't know A absorbed it still gives A channels
 * added to B before. Only an edge case of an edge case, and no channel is lost.
 */
function withGone(group: Group, gone: Map<string, Group>): Group {
  const done = new Set<string>();
  for (;;) {
    // Those it absorbed, including those it just got from one it absorbed
    const found = [...gone.values()].filter((g) => group.absorbed?.[g.id] && !done.has(g.id));
    if (!found.length) return group;
    for (const copy of found) {
      done.add(copy.id);
      group = withAbsorbed(group, {
        ...copy.absorbed,
        [copy.id]: { channelIds: copy.channelIds, updatedAt: copy.updatedAt ?? 0 },
      });
    }
  }
}

/**
 * Two copies of the same group as one: the one changed last, with the
 * channels of groups the other absorbed that it didn't know of, or knew of as
 * they were before.
 */
function mergeCopies(x: Group, y: Group): Group {
  const [winner, loser] = isNewer(x, y) ? [x, y] : [y, x];
  return withAbsorbed(winner, loser.absorbed);
}

/**
 * The group knowing of the groups in `absorbed` too, with the channels of
 * those it didn't know of, or knew of as they were before. Those channels were
 * never removed from it, since it never had them; those it removed since
 * absorbing a group, it doesn't get back.
 */
function withAbsorbed(group: Group, absorbed: Group['absorbed']): Group {
  const merged = mergeAbsorbed(group.absorbed, absorbed);
  if (!merged) return group;
  const added = Object.entries(absorbed ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([id, other]) => {
      const known = group.absorbed?.[id];
      if (known && known.updatedAt >= other.updatedAt) return [];
      return other.channelIds.filter((c) => !known?.channelIds.includes(c));
    });
  return {
    ...group,
    channelIds: [...new Set([...group.channelIds, ...added])],
    absorbed: merged,
  };
}

/** The groups absorbed per either, of each the copy changed last */
function mergeAbsorbed(
  a: Group['absorbed'],
  b: Group['absorbed'],
): Group['absorbed'] | undefined {
  if (!a || !b) return a ?? b;
  const merged = { ...a };
  for (const [id, group] of Object.entries(b)) {
    const other = merged[id];
    if (
      !other ||
      (group.updatedAt !== other.updatedAt
        ? group.updatedAt > other.updatedAt
        : JSON.stringify(group.channelIds) > JSON.stringify(other.channelIds))
    ) {
      merged[id] = group;
    }
  }
  return merged;
}

/** Whether `a` wins over `b`, another copy of the same group */
function isNewer(a: Group, b: Group): boolean {
  const at = a.updatedAt ?? 0;
  const bt = b.updatedAt ?? 0;
  // Copies changed at the same time on two devices: any choice will do, but
  // both devices must make the same, whichever copy each has. Only copies the
  // same in every way, which merge the same either way, tie.
  return at !== bt ? at > bt : contentKey(a) > contentKey(b);
}

function contentKey({ name, color, channelIds, absorbed }: Group): string {
  const absorbedGroups = Object.entries(absorbed ?? {})
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([id, g]) => [id, g.updatedAt, g.channelIds]);
  return JSON.stringify([name, color, channelIds, absorbedGroups]);
}
