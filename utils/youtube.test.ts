import { describe, expect, it } from 'vitest';
import channelVideos from './__fixtures__/channel-videos.json';
import home from './__fixtures__/home.json';
import homeContinuation from './__fixtures__/home-continuation.json';
import subscriptions from './__fixtures__/subscriptions.json';
import watchLater from './__fixtures__/watch-later.json';
import {
  parseChannelVideos,
  parseHomeContinuation,
  parseHomePage,
  parseSubscriptionsPage,
  parseWatchLaterContinuation,
  parseWatchLaterPage,
} from './youtube';

// The fixtures are real YouTube data with titles, names, IDs, URLs and
// tokens replaced by placeholders and the digits of counts scrambled.
// utils/__fixtures__/README.md explains how to capture new ones.

/** A YouTube page embedding `data` the way YouTube does */
function page(data: unknown) {
  return `<html><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

describe('parseHomePage', () => {
  const { videos, continuation } = parseHomePage(page(home));

  it('reads the videos in feed order', () => {
    expect(videos.map((v) => v.id)).toEqual([
      'video000001',
      'video000002',
      'video000003',
      'video000004',
      'video000005',
      'video000006',
    ]);
  });

  it('skips playlists', () => {
    // video000008 is a playlist (a mix) in the fixture.
    expect(videos.map((v) => v.id)).not.toContain('video000008');
  });

  it('reads title, thumbnail, duration, channel and details', () => {
    expect(videos[0]).toEqual({
      id: 'video000001',
      title: 'Text 7',
      thumbnail: 'https://i.ytimg.com/vi/video000001/hqdefault.jpg',
      duration: '3:38',
      channel: {
        title: 'Text 9',
        url: 'https://www.youtube.com/@channel1',
        avatar: 'https://yt3.ggpht.com/image-3',
      },
      details: [
        { text: '9.3K', label: '9.3 thousand views', hasPlayIcon: true },
        // YouTube puts a no-break space in short ages.
        { text: '67\u00a0min ago', label: '67 minutes ago', hasPlayIcon: false },
      ],
      feedback: {
        notInterested: { token: 'token-3', undoToken: 'token-4' },
        dontRecommendChannel: { token: 'token-5', undoToken: 'token-6' },
      },
    });
  });

  it("reads every video's Not interested and Don't recommend channel items", () => {
    for (const { feedback } of videos) {
      expect(feedback.notInterested?.token).toMatch(/^token-/);
      expect(feedback.notInterested?.undoToken).toMatch(/^token-/);
      expect(feedback.dontRecommendChannel?.token).toMatch(/^token-/);
      expect(feedback.dontRecommendChannel?.undoToken).toMatch(/^token-/);
    }
  });

  it('links collaborations to their first channel', () => {
    const collab = videos[1]!;
    expect(collab.channel).toEqual({
      title: 'Text 33',
      url: 'https://www.youtube.com/channel/UCchannel000000000000002',
      avatar: 'https://yt3.ggpht.com/image-6',
    });
    // The other channels' names come first in the details.
    expect(collab.details.map((d) => d.text)).toEqual(['Text 40', '835K', '8mo ago']);
  });

  it('reads how much of a video was watched', () => {
    expect(videos.map((v) => v.progress)).toEqual([
      undefined,
      undefined,
      undefined,
      34,
      undefined,
      undefined,
    ]);
  });

  it('falls back to the channel ID when a channel has no handle', () => {
    expect(videos[3]!.channel?.url).toBe(
      'https://www.youtube.com/channel/UCchannel000000000000005',
    );
  });

  it('reads the token for the next page', () => {
    expect(continuation).toBe('token-60');
  });

  it('fails on pages without YouTube data', () => {
    expect(() => parseHomePage('<html></html>')).toThrow(/not found/);
  });
});

describe('parseHomeContinuation', () => {
  const { videos, continuation } = parseHomeContinuation(homeContinuation);

  it('reads the videos and skips the ones in shelves', () => {
    // video000014 is in a shelf of topic chips with videos.
    expect(videos.map((v) => v.id)).toEqual([
      'video000009',
      'video000010',
      'video000011',
      'video000012',
      'video000013',
      'video000015',
    ]);
  });

  it('reads videos like the first page does', () => {
    expect(videos[3]).toEqual({
      id: 'video000012',
      title: 'Text 132',
      thumbnail: 'https://i.ytimg.com/vi/video000012/hqdefault.jpg',
      duration: '4:27:00',
      channel: {
        title: 'Text 134',
        url: 'https://www.youtube.com/@channel8',
        avatar: 'https://yt3.ggpht.com/image-31',
      },
      details: [
        { text: '107K', label: '107 thousand views', hasPlayIcon: true },
        { text: '4y ago', label: '4 year ago', hasPlayIcon: false },
      ],
      progress: 31,
      feedback: {
        notInterested: { token: 'token-86', undoToken: 'token-87' },
        dontRecommendChannel: { token: 'token-88', undoToken: 'token-89' },
      },
    });
  });

  it('reads the token for the page after', () => {
    expect(continuation).toBe('token-112');
  });

  it('returns nothing for an unrelated response', () => {
    expect(parseHomeContinuation({})).toEqual({ videos: [], continuation: undefined });
  });
});

describe('parseWatchLaterPage', () => {
  const { videos, continuation } = parseWatchLaterPage(page(watchLater));

  it('reads the videos in playlist order', () => {
    expect(videos.map((v) => v.id)).toEqual([
      'video000014',
      'video000015',
      'video000016',
      'video000017',
    ]);
  });

  it('reads videos like Home, with what removing them needs', () => {
    expect(videos[0]).toEqual({
      id: 'video000014',
      title: 'Text 167',
      thumbnail: 'https://i.ytimg.com/vi/video000014/hqdefault.jpg',
      duration: '4:04:02',
      channel: { title: 'Text 169', url: 'https://www.youtube.com/@channel12' },
      details: [
        { text: '89K', hasPlayIcon: true },
        { text: '7y ago', hasPlayIcon: false },
      ],
      progress: 56,
      feedback: {},
      watchLaterRemoval: {
        playlistId: 'WL',
        actions: [{ setVideoId: 'entry-91', action: 'ACTION_REMOVE_VIDEO' }],
        params: 'Text 175',
      },
    });
  });

  it('has no token for more when the playlist fits on the page', () => {
    // The fixture's playlist is short; YouTube pages it from 100 videos.
    expect(continuation).toBeUndefined();
  });

  it('fails on pages without YouTube data', () => {
    expect(() => parseWatchLaterPage('<html></html>')).toThrow(/not found/);
  });
});

describe('parseWatchLaterContinuation', () => {
  it('reads videos and the next token from an API response', () => {
    // Shaped like YouTube's response for more of a long playlist
    const items = (watchLater as any).contents.playlistVideoListRenderer.contents;
    const response = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              ...items,
              {
                continuationItemRenderer: {
                  continuationEndpoint: { continuationCommand: { token: 'next' } },
                },
              },
            ],
          },
        },
      ],
    };
    const { videos, continuation } = parseWatchLaterContinuation(response);
    expect(videos).toHaveLength(4);
    expect(continuation).toBe('next');
  });
});

describe('parseSubscriptionsPage', () => {
  it('reads the channels with what unsubscribing needs', () => {
    expect(parseSubscriptionsPage(page(subscriptions))).toEqual([
      {
        id: 'UCchannel000000000000016',
        title: 'Text 165',
        avatar: 'https://yt3.ggpht.com/image-40',
        unsubscribeParams: 'Text 187',
      },
      {
        id: 'UCchannel000000000000017',
        title: 'Text 188',
        avatar: 'https://yt3.ggpht.com/image-42',
        unsubscribeParams: 'Text 187',
      },
      {
        id: 'UCchannel000000000000018',
        title: 'Text 198',
        avatar: 'https://yt3.ggpht.com/image-44',
        unsubscribeParams: 'Text 187',
      },
    ]);
  });

  it('fails on pages without YouTube data', () => {
    expect(() => parseSubscriptionsPage('<html></html>')).toThrow(/not found/);
  });
});

describe('parseChannelVideos', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('reads the videos newest first, dated by their age, with their durations', () => {
    expect(parseChannelVideos(channelVideos, now)).toEqual([
      {
        id: 'video000001',
        title: 'Text 7',
        published: new Date(now - 5 * day).toISOString(),
        views: 412e6,
        duration: '98:27',
      },
      {
        id: 'video000002',
        title: 'Text 11',
        published: new Date(now - 8 * 7 * day).toISOString(),
        views: 809e6,
        duration: '17:55',
      },
      {
        id: 'video000003',
        title: 'Text 13',
        published: new Date(now - 4 * 30 * day).toISOString(),
        views: 449e6,
        duration: '45:08',
      },
      {
        id: 'video000004',
        title: 'Text 15',
        published: new Date(now - 4 * 30 * day).toISOString(),
        views: 488e6,
        duration: '68:33',
      },
    ]);
  });

  it('reads how much of a video was watched', () => {
    const data = structuredClone(channelVideos) as any;
    const overlay =
      data.contents.richGridRenderer.contents[0].richItemRenderer.content.lockupViewModel
        .contentImage.thumbnailViewModel.overlays[0].thumbnailBottomOverlayViewModel;
    // As YouTube sends it for videos the user started watching
    overlay.progressBar = { thumbnailOverlayProgressBarViewModel: { startPercent: 42 } };
    expect(parseChannelVideos(data, now).map((v) => v.progress)).toEqual([
      42,
      undefined,
      undefined,
      undefined,
    ]);
  });

  /**
   * The fixture with the first video's view count and age replaced by
   * `parts`: texts, or [text, label] pairs.
   */
  function withFirstVideoDetails(...parts: (string | [string, string])[]) {
    const data = structuredClone(channelVideos) as any;
    const metadata =
      data.contents.richGridRenderer.contents[0].richItemRenderer.content.lockupViewModel
        .metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel;
    metadata.metadataRows = [
      {
        metadataParts: parts.map((part) =>
          typeof part === 'string'
            ? { text: { content: part } }
            : { text: { content: part[0] }, accessibilityLabel: part[1] },
        ),
      },
    ];
    return parseChannelVideos(data, now);
  }

  it('reads ages down to the second', () => {
    expect(withFirstVideoDetails('1 view', '53 minutes ago')[0]).toMatchObject({
      published: new Date(now - 53 * 60 * 1000).toISOString(),
      views: 1,
    });
    expect(withFirstVideoDetails('1 second ago')[0]?.published).toBe(
      new Date(now - 1000).toISOString(),
    );
  });

  it('reads view counts in each of the ways YouTube writes them', () => {
    const views = (text: string) => withFirstVideoDetails(text, '1 day ago')[0]?.views;
    expect(views('No views')).toBe(0);
    expect(views('523 views')).toBe(523);
    expect(views('1,234 views')).toBe(1234);
    expect(views('4.7K views')).toBe(4700);
    expect(views('1.2B views')).toBe(1.2e9);
  });

  it('reads the short view counts and ages logged-in users get', () => {
    // As YouTube sends them, with the full text in the label
    expect(
      withFirstVideoDetails(['1.5M', '1.5 million views'], ['2w ago', '2 weeks ago'])[0],
    ).toMatchObject({
      published: new Date(now - 14 * day).toISOString(),
      views: 1.5e6,
    });
    // Without labels
    const short = (...texts: string[]) => withFirstVideoDetails(...texts)[0];
    expect(short('102K', '1h ago')).toMatchObject({
      published: new Date(now - 60 * 60 * 1000).toISOString(),
      views: 102e3,
    });
    expect(short('60', '3 min ago')).toMatchObject({
      published: new Date(now - 3 * 60 * 1000).toISOString(),
      views: 60,
    });
    expect(short('5mo ago')?.published).toBe(new Date(now - 5 * 30 * day).toISOString());
    expect(short('1y ago')?.published).toBe(new Date(now - 365 * day).toISOString());
  });

  it('skips videos that are yet to come out', () => {
    const videos = withFirstVideoDetails('Premieres 10/30/26, 6:00 PM');
    expect(videos.map((v) => v.id)).not.toContain('video000001');
    expect(videos).toHaveLength(3);
  });

  it('returns nothing for a channel without videos', () => {
    expect(parseChannelVideos({ contents: {} }, now)).toEqual([]);
  });
});
