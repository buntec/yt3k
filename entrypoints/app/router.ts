import { useSyncExternalStore } from 'react';

// Hash routes (app.html#/feed): extension pages have no server to fall back
// to index.html, so a reload on a path route would not find the page.
export const ROUTES = {
  subscriptions: 'Subs',
  live: 'Live',
  feed: 'Feed',
  search: 'Search',
  'watch-later': 'Watch later',
  history: 'History',
  podcasts: 'Podcasts',
} as const;

export type Route = keyof typeof ROUTES;

const DEFAULT_ROUTE: Route = 'subscriptions';

// The query of the last search shown, so that coming back to Search from
// another page shows its results again.
let lastSearchQuery = '';

export function routeHref(route: Route) {
  return `#/${route}`;
}

/**
 * Where links to the Search page go: the last search shown, which is the
 * current one on Search itself.
 */
export function useSearchPageHref(): string {
  return useSyncExternalStore(subscribe, () => {
    if (currentRoute() === 'search') lastSearchQuery = currentSearchQuery();
    return searchHref(lastSearchQuery);
  });
}

/** The Search page with YouTube's results for `query`, e.g. #/search?q=piano */
export function searchHref(query: string) {
  return query ? `#/search?${new URLSearchParams({ q: query })}` : '#/search';
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute);
}

/** The query in a Search page's URL, or "" */
export function useSearchQuery(): string {
  return useSyncExternalStore(subscribe, currentSearchQuery);
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentRoute(): Route {
  const [path = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return Object.hasOwn(ROUTES, path) ? (path as Route) : DEFAULT_ROUTE;
}

function currentSearchQuery(): string {
  if (currentRoute() !== 'search') return '';
  const search = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(search).get('q')?.trim() ?? '';
}
