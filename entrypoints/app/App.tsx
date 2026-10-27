import { Activity, useEffect, useState } from 'react';
import { AppShell } from '@astryxdesign/core/AppShell';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack } from '@astryxdesign/core/Stack';
import { Switch } from '@astryxdesign/core/Switch';
import { Theme } from '@astryxdesign/core/theme';
import { TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core/TopNav';
import { defaultThemeSlug, themes } from '@/astryx-themes';
import { setAutoplay, useAutoplay } from './autoplay';
import { FeedPage } from './feed/FeedPage';
import { HistoryPage } from './history/HistoryPage';
import { PlayerProvider } from './player';
import { ROUTES, type Route, routeHref, useRoute } from './router';
import { SubscriptionsPage } from './subscriptions/SubscriptionsPage';
import { WatchLaterPage } from './watch-later/WatchLaterPage';
import { type ThemeMode, setThemeMode, useThemeMode } from './theme';

const PAGES: Record<Route, () => React.ReactNode> = {
  subscriptions: SubscriptionsPage,
  feed: FeedPage,
  'watch-later': WatchLaterPage,
  history: HistoryPage,
};

export function App() {
  const route = useRoute();
  const mode = useThemeMode();
  const autoplay = useAutoplay();
  const Page = PAGES[route];
  // Subs stays mounted, hidden, once shown: rendering its hundreds of videos
  // again takes long enough to notice on every return from another page.
  const [keepSubs, setKeepSubs] = useState(route === 'subscriptions');
  if (route === 'subscriptions' && !keepSubs) setKeepSubs(true);

  useEffect(() => {
    document.title = `${ROUTES[route]} · yt3k`;
  }, [route]);

  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      <PlayerProvider>
        <AppShell
          topNav={
            <TopNav
              label="Pages"
              heading={
                <TopNavHeading
                  logo={<img className="logo" src="/favicon.svg" alt="" />}
                  logoLabel="yt3k"
                  headingHref={routeHref('subscriptions')}
                />
              }
              startContent={(Object.keys(ROUTES) as Route[]).map((r) => (
                <TopNavItem
                  key={r}
                  label={ROUTES[r]}
                  href={routeHref(r)}
                  isSelected={r === route}
                />
              ))}
              endContent={
                <HStack gap={4} vAlign="center">
                  <Switch
                    label="Autoplay"
                    labelTooltip="Videos that start on their own aren't added to your YouTube watch history"
                    labelPosition="start"
                    size="sm"
                    value={autoplay}
                    onChange={setAutoplay}
                  />
                  <SegmentedControl
                    label="Theme"
                    size="sm"
                    value={mode}
                    onChange={(value) => setThemeMode(value as ThemeMode)}
                  >
                    <SegmentedControlItem value="system" label="System" />
                    <SegmentedControlItem value="light" label="Light" />
                    <SegmentedControlItem value="dark" label="Dark" />
                  </SegmentedControl>
                </HStack>
              }
            />
          }
        >
          {keepSubs && (
            <Activity mode={route === 'subscriptions' ? 'visible' : 'hidden'}>
              <SubscriptionsPage />
            </Activity>
          )}
          {route !== 'subscriptions' && <Page />}
        </AppShell>
      </PlayerProvider>
    </Theme>
  );
}
