import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // The browsers the release builds for; WXT rejects any other `-b` value.
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  // Firefox too: WXT defaults it to MV2, which has no browser.action.
  manifestVersion: 3,
  manifest: ({ browser, command }) => ({
    name: 'yt3k',
    description: 'A decluttered UI for YouTube',
    // cookies: sign requests to YouTube's API like YouTube's web client does.
    // declarativeNetRequestWithHostAccess: give the embedded player a Referer,
    // and those API requests youtube.com as their origin.
    permissions: ['storage', 'cookies', 'declarativeNetRequestWithHostAccess'],
    // Lets the extension page fetch YouTube pages and feeds.
    host_permissions: ['*://www.youtube.com/*'],
    action: { default_title: 'Open yt3k' },
    // An unpacked extension's ID, which its stored groups and subscriptions
    // belong to, otherwise depends on the folder it's loaded from. This public
    // key fixes the ID (jjaoknknijpnllfipmgibppilgojikej), so a release unzipped
    // to a new folder keeps them. The dev build keeps a separate ID.
    ...(browser !== 'firefox' &&
      command === 'build' && {
        key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzGQVjP7kTjMZg4j1LaAFUaCHg0Ule4Ykcz7wZFzCRjGzvt584O4YntvPCzjDDrbG+GwL0i/1DIFp4WCDw/luk7rmFdEFyr+jUqgaSCmS5wnnKmBSIaRBSxnHHSoYV+4mO/h9ZI8aFCwHQVu6qBPcnsImV9u5TWGYMosrl+0JcnN1q1WBL1ff9ehpGbZ2pL5/zh3csKDOBBK+she1XVHDvTlSV2ad+GL+D1OXAv2wCs4xdlGeRxJw1/4jrJtUMBTG3HKVJhlXBzlkxBCoAAkpwOAPxo3T8TU9NuymrIkC6NxgCTjb40wbNCQtvyLgSYhB2N7s/zdbgepKCatMMu5JPwIDAQAB',
      }),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // Firefox needs a fixed ID for MV3 add-ons and to sign them.
          id: 'yt3k@buntec.github.io',
          strict_min_version: '142.0',
          // Where a signed .xpi looks for updates; the release workflow
          // publishes this file next to it.
          update_url: 'https://github.com/buntec/yt3k/releases/latest/download/updates.json',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
