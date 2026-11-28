import { searchMoreVideos, searchVideos } from '@/utils/youtube';
import { type VideoList, createVideoList } from '../videos/list';

// Lists of recent searches, so that going back to one shows its results
// without searching again.
const MAX_KEPT = 10;
const lists = new Map<string, VideoList>();

const noSearch = createVideoList({ first: async () => ({ videos: [] }) });

/** YouTube's videos for `query`, loaded when a page first shows them. */
export function searchResults(query: string): VideoList {
  if (!query) return noSearch;
  let list = lists.get(query);
  if (list) {
    // Most recently used last
    lists.delete(query);
  } else {
    list = createVideoList({ first: () => searchVideos(query), more: searchMoreVideos });
  }
  lists.set(query, list);
  for (const old of lists.keys()) {
    if (lists.size <= MAX_KEPT) break;
    lists.delete(old);
  }
  return list;
}
