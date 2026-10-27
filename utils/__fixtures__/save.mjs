// Writes the fixtures that capture.js copied (read from stdin) to this folder,
// or only those named as arguments, e.g. `watchLater`.
//
//   pbpaste | node utils/__fixtures__/save.mjs [name...]

import { readFileSync, writeFileSync } from 'node:fs';

const FILES = {
  home: 'home.json',
  homeContinuation: 'home-continuation.json',
  subscriptions: 'subscriptions.json',
  channelVideos: 'channel-videos.json',
  watchLater: 'watch-later.json',
};

const only = process.argv.slice(2);
const fixtures = JSON.parse(readFileSync(0, 'utf8'));
for (const [key, file] of Object.entries(FILES)) {
  if (only.length > 0 && !only.includes(key)) continue;
  if (!fixtures[key]) throw new Error(`Missing "${key}" in the copied fixtures`);
  writeFileSync(new URL(file, import.meta.url), JSON.stringify(fixtures[key], null, 1) + '\n');
  console.log(`Wrote ${file}`);
}
