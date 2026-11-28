import { Clock } from 'lucide-react';
import type { ListedVideo } from '@/utils/youtube';
import { searchHref, useSearchQuery } from '../router';
import { type VideoAction, VideoListView } from '../videos/VideoListView';
import { saveToWatchLater } from '../watch-later/store';
import { searchResults } from './store';

/** YouTube's search results, videos only and without Shorts */
export function SearchPage() {
  const query = useSearchQuery();
  const list = searchResults(query);
  return (
    <VideoListView
      title="Search"
      list={list}
      loadingText="Searching…"
      empty={
        query
          ? { title: 'No results', description: 'Try other words.' }
          : { title: 'Search YouTube', description: 'Videos only, without Shorts.' }
      }
      actions={actions}
      search={{
        query,
        onSearch: (newQuery) => {
          // The same search again looks for new results, as on YouTube.
          if (newQuery === query) void list.refresh();
          else location.hash = searchHref(newQuery);
        },
      }}
    />
  );
}

function actions(video: ListedVideo): VideoAction[] {
  return [
    {
      label: 'Save to Watch later',
      icon: Clock,
      run: (showToast) => void saveToWatchLater(video, showToast),
    },
  ];
}
