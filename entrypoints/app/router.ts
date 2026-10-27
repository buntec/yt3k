import { useSyncExternalStore } from 'react';

// Hash routes (app.html#/feed): extension pages have no server to fall back
// to index.html, so a reload on a path route would not find the page.
export const ROUTES = {
  subscriptions: 'Subs',
  feed: 'Feed',
  'watch-later': 'Watch later',
} as const;

export type Route = keyof typeof ROUTES;

const DEFAULT_ROUTE: Route = 'subscriptions';

export function routeHref(route: Route) {
  return `#/${route}`;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute);
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function currentRoute(): Route {
  const path = location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(ROUTES, path) ? (path as Route) : DEFAULT_ROUTE;
}
