# yt3k

A decluttered YouTube UI as a browser extension for Firefox, Chrome, Edge and other
Chromium browsers. Rather than altering youtube.com, its toolbar button opens a page
of its own, signed in with the YouTube account you use in that browser.

- **Subs**: your subscriptions, latest upload first, each with its newest videos (no
  Shorts) and an unsubscribe button. Sort channels into colored groups and filter by
  them; groups can be exported, imported, or synced through Google Drive.
- **Live**: live streams from your subscriptions, refreshed every minute.
- **Feed**: YouTube's Home recommendations without Shorts or shelves, with **Not
  interested** and **Don't recommend channel**.
- **Watch later** and **History** (by day, no Shorts, entries removable).
- **Podcasts**: the newest episodes of podcasts you follow by RSS, on YouTube or not.
  Search Apple's directory, paste a feed or Apple Podcasts link, or import and export
  OPML. Episodes play at your chosen speed, resume where you left off, and respond to
  media keys.

Every tab has search (`/`), and any video can be added to or removed from Watch
later. Videos play in an embedded player that minimizes to a corner while you
browse. **Autoplay** is off by default, since YouTube leaves autoplayed videos out of
your history.

## Install

Download a build from the [releases](https://github.com/buntec/yt3k/releases):

- **Chrome** and other Chromium browsers: unzip `yt3k-x.y.z-chrome.zip`, enable
  **Developer mode** in `chrome://extensions`, click **Load unpacked** and pick the
  folder. Update the same way; your data is kept.
- **Edge**: the same with `yt3k-x.y.z-edge.zip` in `edge://extensions`.
- **Firefox**: open `yt3k-x.y.z-firefox.xpi` in Firefox and confirm. It updates
  itself.

## Google Drive sync

Groups and followed podcasts can sync through a hidden app-data file in your Google
Drive; yt3k sees nothing else there. Playback progress stays in each browser.
**Turn off sync** affects only that browser; to revoke access everywhere, use your
Google account's [third-party connections](https://myaccount.google.com/connections).

## Disclaimer

yt3k is unofficial and not affiliated with YouTube or Google. It relies on YouTube's
undocumented internal API, so parts may break until it's updated, and actions like
unsubscribing apply to your real account. yt3k collects nothing: it talks only to
YouTube, your Google Drive (if sync is on), Apple's podcast directory (when you
search), and the sites hosting your podcasts. Use it at your own risk.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md). Built with [WXT](https://wxt.dev), React and
[Astryx](https://astryx.atmeta.com). Licensed under [MIT](LICENSE).
