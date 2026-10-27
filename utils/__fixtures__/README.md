# Parser fixtures

Real YouTube data for `utils/youtube.test.ts`, anonymized: titles, names, IDs,
URLs and tokens are replaced with placeholders (`Text 7`, `video000001`,
`token-60`, …), the digits of view counts, ages and durations are scrambled
with a new random key each time, watch positions and lengths in seconds are
random, and colors taken from thumbnails are left out.

- `home.json`: the feed part of the Home page's `ytInitialData`
- `home-continuation.json`: YouTube's API response for the next page of Home
- `subscriptions.json`: the "All subscriptions" page's `ytInitialData`
- `channel-videos.json`: the video grid of YouTube's API response for a
  subscribed channel's Videos tab, in English
- `watch-later.json`: the playlist part of the Watch later page's `ytInitialData`

Each keeps only a few items of each kind: regular videos, a collaboration, a
playlist, a shelf and the token for the next page (Watch later has one only
with more than 100 videos).

## Capturing new ones

When YouTube changes its data and the parsers need updating:

1. Open youtube.com in a browser where you're logged in.
2. Paste `capture.js` into the DevTools console and run it. A red **Copy
   fixtures** button appears on the page. Click it.
3. Run `pbpaste | node utils/__fixtures__/save.mjs`.
4. Look over the diff for anything that wasn't anonymized, then update the
   parsers and the expected values in the tests.
