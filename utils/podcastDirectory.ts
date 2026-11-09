/*
 * Finding podcasts by name in Apple's podcast directory, through its public
 * search API, which lists the RSS feed of each podcast that has a public one.
 */

/** A podcast as Apple's directory lists it */
export interface DirectoryPodcast {
  feedUrl: string;
  title: string;
  author?: string;
  image?: string;
  /** How many episodes Apple knows of */
  episodeCount?: number;
  genre?: string;
}

const API = 'https://itunes.apple.com';

/** The match pattern of the directory's site, for the permission to search it */
export const DIRECTORY_ORIGIN = `${API}/*`;

/** How many podcasts a search lists */
const SEARCH_LIMIT = 25;

/**
 * The podcasts matching the name or words, best match first. `country` is a
 * two-letter code picking the store searched, which ranks local podcasts first.
 */
export async function searchDirectory(
  term: string,
  country?: string,
): Promise<DirectoryPodcast[]> {
  const params = new URLSearchParams({
    term,
    media: 'podcast',
    entity: 'podcast',
    limit: String(SEARCH_LIMIT),
  });
  if (country) params.set('country', country);
  return parseDirectoryResults(await getJson(`${API}/search?${params}`));
}

/** The podcast with the ID from an Apple Podcasts link, if it has a public feed */
export async function lookupDirectory(id: string): Promise<DirectoryPodcast[]> {
  const params = new URLSearchParams({ id, entity: 'podcast' });
  return parseDirectoryResults(await getJson(`${API}/lookup?${params}`));
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'omit' });
  } catch (err) {
    throw new Error("Couldn't reach Apple's podcast directory", { cause: err });
  }
  if (!res.ok) throw new Error(`Apple's podcast directory answered ${res.status}`);
  return res.json();
}

/**
 * The podcasts in a response of the search or lookup API. Those without a
 * public feed, e.g. ones only Apple's app plays, are left out: they can't be
 * followed here.
 */
export function parseDirectoryResults(json: unknown): DirectoryPodcast[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((value): DirectoryPodcast[] => {
    const r = value as Record<string, unknown> | null;
    if (r?.kind !== 'podcast') return [];
    const feedUrl = string(r.feedUrl);
    const title = string(r.collectionName) ?? string(r.trackName);
    if (!feedUrl || !title) return [];
    return [
      {
        feedUrl,
        title,
        author: string(r.artistName),
        image: string(r.artworkUrl600) ?? string(r.artworkUrl100),
        episodeCount: typeof r.trackCount === 'number' ? r.trackCount : undefined,
        genre: string(r.primaryGenreName),
      },
    ];
  });
}

/** The ID in an Apple Podcasts link like podcasts.apple.com/us/podcast/name/id123 */
export function applePodcastId(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return undefined;
  }
  if (url.hostname !== 'podcasts.apple.com' && url.hostname !== 'itunes.apple.com') {
    return undefined;
  }
  return /\/id(\d+)(\/|$)/.exec(url.pathname)?.[1] ?? url.searchParams.get('id') ?? undefined;
}

/**
 * Whether what was typed is an address rather than words to search for:
 * one word with a dot in it, like example.com/feed or a pasted link.
 */
export function isAddress(input: string): boolean {
  const text = input.trim();
  return /^[a-z][a-z\d+.-]*:\/\//i.test(text) || /^[^\s/]+\.[^\s/]+(\/\S*)?$/.test(text);
}

/** The two-letter country of the browser's language, e.g. GB for en-GB, if it names one */
export function browserCountry(languages: readonly string[]): string | undefined {
  for (const language of languages) {
    const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(language)?.[1];
    if (region) return region.toUpperCase();
  }
  return undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
