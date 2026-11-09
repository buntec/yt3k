/*
 * OPML, the file podcast apps import and export the podcasts followed in:
 * an outline whose entries name each podcast's RSS feed.
 */

/** A podcast as an OPML file lists it */
export interface OpmlPodcast {
  /** As the file has it, which may need cleaning up */
  feedUrl: string;
  title?: string;
}

/** Thrown for a file that isn't OPML */
export class NotOpmlError extends Error {}

/**
 * The podcasts an OPML file lists, in its order, each once. Outlines can be
 * nested, e.g. in folders, and apps name the feed's attribute differently.
 */
export function parseOpml(text: string): OpmlPodcast[] {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root?.nodeName.toLowerCase() !== 'opml') {
    throw new NotOpmlError("That isn't an OPML file");
  }
  const seen = new Set<string>();
  const podcasts: OpmlPodcast[] = [];
  for (const outline of root.getElementsByTagName('outline')) {
    const feedUrl =
      attribute(outline, 'xmlUrl') ?? (isFeed(outline) ? attribute(outline, 'url') : undefined);
    if (!feedUrl || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    podcasts.push({ feedUrl, title: attribute(outline, 'text') ?? attribute(outline, 'title') });
  }
  return podcasts;
}

/** Whether the outline is marked as a feed, as some apps mark those with a `url` */
function isFeed(outline: Element) {
  const type = attribute(outline, 'type')?.toLowerCase();
  return type === 'rss' || type === 'link';
}

/** The attribute, whatever the case of its name, which apps don't agree on */
function attribute(el: Element, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const attr of el.attributes) {
    if (attr.name.toLowerCase() === lower) return attr.value.trim() || undefined;
  }
  return undefined;
}

/** An OPML file listing the podcasts, as podcast apps import them */
export function serializeOpml(podcasts: { feedUrl: string; title: string }[], now: Date): string {
  const outlines = podcasts.map(({ feedUrl, title }) => {
    const name = escape(title);
    return `    <outline type="rss" text="${name}" title="${name}" xmlUrl="${escape(feedUrl)}"/>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Podcasts followed in yt3k</title>',
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...outlines,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\t\n\r]/g, ' ');
}
