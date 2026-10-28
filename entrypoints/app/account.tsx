import { useSyncExternalStore } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { type Account, fetchAccount } from '@/utils/youtube';

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F';

// Undefined until known, null when logged out.
let account: Account | null | undefined;
const listeners = new Set<() => void>();
let started = false;

/** The YouTube account the app acts as, or a link to log in. */
export function AccountStatus() {
  const current = useSyncExternalStore(subscribe, () => account);
  if (current === undefined) return null;
  if (current === null) {
    return <Button label="Log in to YouTube" size="sm" href={LOGIN_URL} target="_blank" />;
  }
  const who = current.handle ? `${current.name} (${current.handle})` : current.name;
  return (
    <Avatar
      src={current.avatar}
      name={current.name}
      size="sm"
      href="https://www.youtube.com/account"
      target="_blank"
      tooltip={`Logged in to YouTube as ${who}`}
    />
  );
}

function subscribe(onChange: () => void) {
  if (!started) {
    started = true;
    void load();
    // Logging in or out happens on youtube.com, in another browser tab.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void load();
    });
  }
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

async function load() {
  try {
    account = (await fetchAccount()) ?? null;
  } catch (err) {
    // Keep showing what was known before.
    console.warn(err);
    return;
  }
  for (const listener of listeners) listener();
}
