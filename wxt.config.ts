import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // The browsers the release builds for; WXT rejects any other `-b` value.
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  // Firefox too: WXT defaults it to MV2, which has no browser.action.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'yt3k',
    description: 'UX improvements for YouTube',
    // cookies: sign requests to YouTube's API like YouTube's web client does.
    // declarativeNetRequestWithHostAccess: give the embedded player a Referer,
    // and those API requests youtube.com as their origin.
    permissions: ['storage', 'cookies', 'declarativeNetRequestWithHostAccess'],
    // Lets the extension page fetch YouTube pages and feeds.
    host_permissions: ['*://www.youtube.com/*'],
    action: { default_title: 'Open yt3k' },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Firefox needs a fixed ID for MV3 add-ons and to sign them.
          id: 'yt3k@buntec.github.io',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
