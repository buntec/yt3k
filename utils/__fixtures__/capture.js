// Captures anonymized fixtures for utils/youtube.test.ts from YouTube.
// See README.md in this folder for how to use it.
//
// Keeps a few items of each kind from the Home page, the next page of Home,
// the subscriptions page, a subscribed channel's Videos tab, Watch later and
// History (and its next part), then replaces titles, names, IDs,
// URLs and tokens with placeholders and scrambles the digits of counts, ages
// and durations. Clipboard writes need a click, so it adds a button for that.

const findAll = (node, key, found = []) => {
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) found.push(v);
      else findAll(v, key, found);
    }
  }
  return found;
};
const initialData = (html) =>
  JSON.parse(html.match(/var ytInitialData = (\{.*?\});<\/script>/s)[1]);

// --- Anonymization ---------------------------------------------------------

const maps = {};
const counters = {};
const alias = (kind, value, make) => {
  maps[kind] ??= new Map();
  if (!maps[kind].has(value)) {
    counters[kind] = (counters[kind] ?? 0) + 1;
    maps[kind].set(value, make(counters[kind]));
  }
  return maps[kind].get(value);
};
const pad = (n, length) => String(n).padStart(length, '0');
// Same lengths as real IDs.
const videoId = (id) => alias('video', id, (n) => 'video' + pad(n, 6));
const channelId = (id) => alias('channel', id, (n) => 'UCchannel' + pad(n, 15));

// Strings that say nothing about what was watched or recommended.
const SAFE = [
  /^[A-Z][A-Z0-9_]*$/, // enums like LOCKUP_CONTENT_TYPE_VIDEO
  /^(LIVE|SHORTS|New|Members only|Premiere|Upcoming|No views)$/i,
  /^\s*[·•]?\s*$/, // separators
  /^(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/, // History's days
];
// Counts, ages and durations: the format is kept, the digits scrambled.
const NUMERIC = [
  /^\d+(:\d\d)+$/,
  /^[\d.,]+[KMB]?$/,
  /^[\d.,]+[KMB]?\s*(thousand|million|billion)?\s*views?$/i,
  /^\d+\s*(s|m|min|h|d|w|mo|y)\s+ago$/i,
  /^(Streamed\s+)?\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i,
];
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
/** 1 to `max` in random order, keyed by digit; 0 stays 0 so numbers gain no leading zeros. */
const shuffledDigits = (max) => {
  const digits = Array.from({ length: max }, (_, i) => String(i + 1));
  for (let i = digits.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return Object.fromEntries([['0', '0'], ...digits.map((d, i) => [String(i + 1), d])]);
};
// A new key on every run, so the digits can't be unscrambled from this file.
const DIGITS = shuffledDigits(9);
// Durations stay valid: tens of minutes and seconds below 6.
const TENS = shuffledDigits(5);
const scramble = (s) =>
  /^\d+(:\d\d)+$/.test(s)
    ? s.replace(/:(\d)/g, (_, d) => ':' + TENS[d]).replace(/(?<!:)\d/g, (d) => DIGITS[d])
    : s.replace(/\d/g, (d) => DIGITS[d]);
// Video lengths and how far they were watched, replaced with random numbers.
const RANDOM_NUMBERS = {
  lengthSeconds: () => randomInt(60, 3 * 60 * 60),
  startTimeSeconds: () => randomInt(1, 60 * 60),
  // Watched to the end stays 100.
  percentDurationWatched: (n) => (n === 100 ? 100 : randomInt(1, 99)),
  startPercent: (n) => (n === 100 ? 100 : randomInt(1, 99)),
};
// Not needed by the parser and large: logging, tracking and colors (some
// taken from the thumbnails).
const DROP_KEYS =
  /^(loggingDirectives|loggingContext|trackingParams|clickTrackingParams|serializedShareEntity|webCommandMetadata|accessibilityContext|themedPalette|onFocusEffect|backgroundColor|stackColor|colorPalette)$/;

function anonymizeString(s, key) {
  if (['contentId', 'videoId', 'addedVideoId', 'removedVideoId'].includes(key)) return videoId(s);
  // Playlist entry IDs, uppercase hex that would pass as an enum below
  if (key === 'setVideoId' || key === 'setVideoIds') return alias('entry', s, (n) => `entry-${n}`);
  if (/^UC[\w-]{22}$/.test(s)) return channelId(s);
  if (/^(https?:)?\/\//.test(s)) {
    const vid = s.match(/\/vi(?:_webp)?\/([\w-]{11})\//)?.[1];
    if (vid) return `https://i.ytimg.com/vi/${videoId(vid)}/hqdefault.jpg`;
    const prefix = s.startsWith('//') ? '//' : 'https://';
    return alias('url', s, (n) => `${prefix}yt3.ggpht.com/image-${n}`);
  }
  if (s.startsWith('/@')) return alias('handle', s, (n) => `/@channel${n}`);
  if (s.startsWith('/channel/')) return '/channel/' + channelId(s.slice(9));
  if (s.startsWith('/')) return alias('path', s, (n) => `/path-${n}`);
  if (SAFE.some((re) => re.test(s))) return s;
  if (NUMERIC.some((re) => re.test(s))) return scramble(s);
  if (key === 'browseId') return alias('browse', s, (n) => `FE${n}`);
  if (/^[\w+/=%-]{24,}$/.test(s)) return alias('token', s, (n) => `token-${n}`);
  return alias('text', s, (n) => `Text ${n}`);
}

function anonymize(node, key) {
  if (Array.isArray(node)) return node.map((v) => anonymize(v, key));
  if (Object.hasOwn(RANDOM_NUMBERS, key) && /^\d+$/.test(String(node))) {
    const n = RANDOM_NUMBERS[key](Number(node));
    return typeof node === 'string' ? String(n) : n;
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !DROP_KEYS.test(k))
        .map(([k, v]) => [k, anonymize(v, k)]),
    );
  }
  return typeof node === 'string' ? anonymizeString(node, key) : node;
}

// --- Selection -------------------------------------------------------------

/** A few feed items of each kind, in feed order. */
function pickFeedItems(items) {
  const lockup = (i) => i.richItemRenderer?.content?.lockupViewModel;
  const isVideo = (i) => lockup(i)?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO';
  const isCollab = (i) =>
    isVideo(i) && !lockup(i).metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel;
  const picks = new Set([
    ...items.filter((i) => isVideo(i) && !isCollab(i)).slice(0, 5),
    items.find(isCollab),
    items.find((i) => lockup(i) && !isVideo(i)), // playlist or mix
    items.find((i) => i.richSectionRenderer), // shelf
    items.find((i) => i.continuationItemRenderer),
  ]);
  return items
    .filter((i) => picks.has(i))
    .map((i) =>
      i.richSectionRenderer
        ? JSON.parse(JSON.stringify(i, (k, v) => (k === 'contents' && Array.isArray(v) ? v.slice(0, 2) : v)))
        : i,
    );
}

/**
 * A few entries of each kind from History's day sections: lockups, the older
 * videoRenderer and a Shorts shelf, from the first `count` sections and those
 * with the rarer kinds.
 */
function pickHistoryItems(items, count) {
  const sections = items.filter((i) => i.itemSectionRenderer);
  const has = (kind) => sections.find((s) => s.itemSectionRenderer.contents.some((c) => c[kind]));
  const picked = new Set([...sections.slice(0, count), has('videoRenderer'), has('reelShelfRenderer')]);
  return items
    .filter((i) => picked.has(i) || i.continuationItemRenderer)
    .map((i) => {
      if (!i.itemSectionRenderer) return i;
      const contents = i.itemSectionRenderer.contents;
      const picks = new Set([
        ...contents.filter((c) => c.lockupViewModel).slice(0, 3),
        contents.find((c) => c.videoRenderer),
        contents.find((c) => c.reelShelfRenderer),
      ]);
      return {
        itemSectionRenderer: {
          ...i.itemSectionRenderer,
          contents: contents
            .filter((c) => picks.has(c))
            .map((c) =>
              c.reelShelfRenderer
                ? { reelShelfRenderer: { ...c.reelShelfRenderer, items: c.reelShelfRenderer.items.slice(0, 2) } }
                : c,
            ),
        },
      };
    });
}

/** Same request as innertubeRequest() in utils/youtube.ts, made from a youtube.com page */
async function innertubeRequest(endpoint, body, { language } = {}) {
  const cookie = (name) =>
    document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
  const sha1 = async (text) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = [];
  for (const [cookieName, scheme] of [
    ['SAPISID', 'SAPISIDHASH'],
    ['__Secure-1PAPISID', 'SAPISID1PHASH'],
    ['__Secure-3PAPISID', 'SAPISID3PHASH'],
  ]) {
    const value = cookie(cookieName);
    if (!value) continue;
    const hash = await sha1(`${timestamp} ${value} ${location.origin}`);
    authorization.push(`${scheme} ${timestamp}_${hash}`);
  }
  const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorization.join(' '),
      'X-Goog-AuthUser': String(ytcfg.get('SESSION_INDEX') ?? 0),
      'X-Origin': location.origin,
    },
    body: JSON.stringify({ context: withLanguage(ytcfg.get('INNERTUBE_CONTEXT'), language), ...body }),
  });
  return res.json();
}

const withLanguage = (context, hl) => (hl ? { ...context, client: { ...context.client, hl } } : context);

async function capture() {
  const homeData = initialData(await (await fetch('/', { credentials: 'include' })).text());
  const grid = findAll(homeData, 'richGridRenderer')[0];
  const home = { contents: { richGridRenderer: { contents: pickFeedItems(grid.contents) } } };

  const more = await innertubeRequest('browse', {
    continuation: findAll(grid.contents, 'continuationCommand').at(-1).token,
  });
  const homeContinuation = {
    onResponseReceivedActions: more.onResponseReceivedActions.map((action) => {
      const append = action.appendContinuationItemsAction;
      if (!append) return action;
      return { appendContinuationItemsAction: { ...append, continuationItems: pickFeedItems(append.continuationItems) } };
    }),
  };

  const subsData = initialData(await (await fetch('/feed/channels', { credentials: 'include' })).text());
  const subscriptions = {
    contents: JSON.parse(
      JSON.stringify(subsData.contents, (k, v) =>
        k === 'items' && Array.isArray(v) && v.some((x) => x.channelRenderer) ? v.slice(0, 3) : v,
      ),
    ),
  };

  // The first subscribed channel's Videos tab, in English like fetchLatestVideos() asks for it.
  const channelData = await innertubeRequest(
    'browse',
    { browseId: findAll(subsData, 'channelRenderer')[0].channelId, params: 'EgZ2aWRlb3PyBgQKAjoA' },
    { language: 'en' },
  );
  const channelGrid = findAll(channelData, 'richGridRenderer')[0];
  const channelVideos = {
    contents: {
      richGridRenderer: {
        contents: [
          ...channelGrid.contents.filter((i) => i.richItemRenderer).slice(0, 4),
          ...channelGrid.contents.filter((i) => i.continuationItemRenderer),
        ],
      },
    },
  };

  // Watch later: a few entries, and the token for more if it's that long.
  const watchLaterData = initialData(
    await (await fetch('/playlist?list=WL', { credentials: 'include' })).text(),
  );
  const playlist = findAll(watchLaterData, 'playlistVideoListRenderer')[0];
  const watchLater = {
    contents: {
      playlistVideoListRenderer: {
        ...playlist,
        contents: [
          ...playlist.contents.filter((i) => i.playlistVideoRenderer).slice(0, 4),
          ...playlist.contents.filter((i) => i.continuationItemRenderer),
        ],
      },
    },
  };

  // History: a few day sections, and a few of the next part.
  const historyData = initialData(
    await (await fetch('/feed/history', { credentials: 'include' })).text(),
  );
  const historyItems = findAll(historyData, 'sectionListRenderer')[0].contents;
  const history = { contents: { sectionListRenderer: { contents: pickHistoryItems(historyItems, 2) } } };
  const moreHistory = await innertubeRequest('browse', {
    continuation: findAll(historyItems.filter((i) => i.continuationItemRenderer), 'continuationCommand').at(-1).token,
  });
  const historyContinuation = {
    onResponseReceivedActions: moreHistory.onResponseReceivedActions.map((action) => {
      const append = action.appendContinuationItemsAction;
      if (!append) return action;
      return { appendContinuationItemsAction: { ...append, continuationItems: pickHistoryItems(append.continuationItems, 1) } };
    }),
  };

  return anonymize({
    home,
    homeContinuation,
    subscriptions,
    channelVideos,
    watchLater,
    history,
    historyContinuation,
  });
}

const fixtures = JSON.stringify(await capture());
document.getElementById('copy-fixtures')?.remove();
const button = document.createElement('button');
button.id = 'copy-fixtures';
button.textContent = 'Copy fixtures';
button.style.cssText =
  'position:fixed;top:80px;left:45%;z-index:99999;padding:16px 24px;font-size:20px;background:#c00;color:#fff;border:0;border-radius:8px';
button.onclick = async () => {
  await navigator.clipboard.writeText(fixtures);
  button.remove();
};
document.body.append(button);
