// @vitest-environment jsdom
// For its DOMParser, which reads XML like browsers' do
import { describe, expect, it } from 'vitest';
import { NotOpmlError, parseOpml, serializeOpml } from './opml';

// Made up, in the shapes podcast apps export
const FLAT = `<?xml version="1.0" encoding="utf-8"?>
<opml version="1.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Show &amp; Tell" type="rss" xmlUrl="https://example.com/feed.xml" />
    <outline title="Only a title" type="rss" xmlUrl="https://example.org/rss" />
    <outline type="rss" xmlUrl="https://example.net/untitled.xml" />
  </body>
</opml>`;

const NESTED = `<?xml version="1.0"?>
<opml version="2.0">
  <body>
    <outline text="feeds">
      <outline text="News" type="rss" xmlURL="https://example.com/news.xml" htmlUrl="https://example.com" />
      <outline text="Folder">
        <outline text="Deep" type="link" url="https://example.com/deep.xml" />
      </outline>
    </outline>
    <outline text="A website, not a feed" type="link" htmlUrl="https://example.com/about" />
    <outline text="News again" type="rss" xmlUrl="https://example.com/news.xml" />
  </body>
</opml>`;

describe('parseOpml', () => {
  it('reads the podcasts in order, with their titles', () => {
    expect(parseOpml(FLAT)).toEqual([
      { feedUrl: 'https://example.com/feed.xml', title: 'Show & Tell' },
      { feedUrl: 'https://example.org/rss', title: 'Only a title' },
      { feedUrl: 'https://example.net/untitled.xml', title: undefined },
    ]);
  });

  it('reads podcasts in folders, however apps name the feed, each once', () => {
    expect(parseOpml(NESTED)).toEqual([
      { feedUrl: 'https://example.com/news.xml', title: 'News' },
      { feedUrl: 'https://example.com/deep.xml', title: 'Deep' },
    ]);
  });

  it("rejects what isn't OPML", () => {
    expect(() => parseOpml('<rss><channel /></rss>')).toThrow(NotOpmlError);
    expect(() => parseOpml('<opml><body><outline')).toThrow(NotOpmlError);
    expect(() => parseOpml('{"format": "yt3k-groups-1"}')).toThrow(NotOpmlError);
  });
});

describe('serializeOpml', () => {
  const podcasts = [
    { feedUrl: 'https://example.com/feed.xml?a=1&b=2', title: 'Show & "Tell" <live>' },
    { feedUrl: 'https://example.org/rss', title: 'Other' },
  ];

  it('writes a file that reads back the same', () => {
    expect(parseOpml(serializeOpml(podcasts, new Date(0)))).toEqual(podcasts);
  });

  it('writes OPML 2.0 with the date it was made', () => {
    const text = serializeOpml(podcasts, new Date(Date.UTC(2026, 10, 9, 12)));
    expect(text).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<opml version="2.0">/);
    expect(text).toContain('<dateCreated>Mon, 09 Nov 2026 12:00:00 GMT</dateCreated>');
    expect(text).toContain(
      '<outline type="rss" text="Other" title="Other" xmlUrl="https://example.org/rss"/>',
    );
  });
});
