import { useSyncExternalStore } from 'react';
import { type Synced, getSynced, onGroupsChanged, updateSynced } from './groups';
import { NewerFormatError, mergeSynced, parseSynced, sameSynced, serializeSynced } from './sync';

/*
 * Syncs groups through a file in the hidden app data folder of the user's
 * Google Drive, which only yt3k can see. Signing in uses the browser's
 * identity API, which all of Chrome, Edge and Firefox have, with Google's
 * token flow: tokens last an hour and are renewed without asking while the
 * user stays signed in to Google.
 */

/** The OAuth client ID, from .env: Drive sync is unavailable without one. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.WXT_GOOGLE_CLIENT_ID ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'groups.json';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** How often to look for changes made elsewhere while the page is shown */
const POLL_INTERVAL = 5 * 60 * 1000;
/** How long after a change to sync it, so a burst of changes syncs once */
const PUSH_DELAY = 3000;

/** Null while sync is off */
interface DriveSettings {
  /**
   * The Google account synced with, as Drive's ID for it, which doesn't
   * change. Every token is checked to be for it: Google may hand out one for
   * another account signed in to the browser. Missing only in settings from
   * before it was kept, which need signing in again.
   */
  accountId?: string;
  /** The Google account's email, if Google told it */
  email?: string;
  /** The Drive ID of the file when last synced: versions only compare within a file */
  fileId?: string;
  /** The Drive version of the file when last synced */
  version?: string;
  /** A hash of the groups when last synced, to skip syncing when neither changed */
  syncedHash?: string;
  /** When sync last finished, in ms since the epoch */
  syncedAt?: number;
}

interface Token {
  value: string;
  expiresAt: number;
  /** The account it's for, as DriveSettings.accountId */
  accountId?: string;
}

const settingsItem = storage.defineItem<DriveSettings | null>('local:driveSync', {
  fallback: null,
});
const tokenItem = storage.defineItem<Token | null>('local:driveToken', { fallback: null });

/**
 * Held to change the account synced with, or to keep a token or a sync's
 * outcome for it, so one tab's sign-in finishing late can't undo another
 * tab's turning sync off or on with another account.
 */
const ACCOUNT_LOCK = 'yt3k-drive-account';

export interface DriveSyncState {
  isOn: boolean;
  email?: string;
  isSyncing: boolean;
  syncedAt?: number;
  /** Why the last sync failed, if it did */
  error?: {
    message: string;
    needsSignIn: boolean;
    /** Firefox doesn't allow sending the groups, as allowDataSending asks */
    needsConsent?: boolean;
  };
}

let state: DriveSyncState = { isOn: false, isSyncing: false };
const listeners = new Set<() => void>();

export function useDriveSync(): DriveSyncState {
  return useSyncExternalStore(subscribe, () => state);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function setState(changes: Partial<DriveSyncState>) {
  state = { ...state, ...changes };
  for (const listener of listeners) listener();
}

function showSettings(settings: DriveSettings | null) {
  // Synced since, maybe in another tab: whatever failed here worked there
  const hasSynced = settings?.syncedAt !== undefined && settings.syncedAt !== state.syncedAt;
  setState({
    isOn: settings !== null,
    email: settings?.email,
    syncedAt: settings?.syncedAt,
    ...((!settings || hasSynced) && { error: undefined }),
  });
}

/** Sync was turned off while syncing, which stops it */
class SyncStopped extends Error {}

/** Aborted when sync is turned off, to stop a sync under way */
let session = new AbortController();

function stopSyncing() {
  session.abort(new SyncStopped('Sync was turned off'));
  session = new AbortController();
}

let started = false;

/** Syncs now and whenever groups change, here or elsewhere, while sync is on. */
export function startDriveSync() {
  if (started) return;
  started = true;
  // The URI to list in the OAuth client, which differs per browser and build
  console.info(`yt3k: Google sign-in redirect URI for this build: ${redirectUri()}`);
  if (!GOOGLE_CLIENT_ID) return;
  void settingsItem.getValue().then((settings) => {
    showSettings(settings);
    if (settings) requestSync();
  });
  // Turned on or off in another tab, or synced there
  settingsItem.watch((settings) => {
    if (!settings) stopSyncing();
    showSettings(settings);
  });
  onGroupsChanged(() => requestSync(PUSH_DELAY));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') requestSync();
  }, POLL_INTERVAL);
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** A sync waiting for its turn, which will see the latest groups when it gets it */
let queued: Promise<void> | undefined;

/** Syncs after `delay` ms, if sync is on. */
function requestSync(delay = 0) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

/** Syncs, if sync is on; resolves when done, whether or not it worked. */
export function syncNow(): Promise<void> {
  clearTimeout(timer);
  if (queued) return queued;
  // One tab at a time, so two don't both create the file
  const run: Promise<void> = navigator.locks
    .request('yt3k-drive-sync', async () => {
      if (queued === run) queued = undefined;
      const { signal } = session;
      try {
        if (!(await settingsItem.getValue())) return;
        setState({ isSyncing: true });
        await sync(signal);
        setState({ isSyncing: false, error: undefined });
      } catch (err) {
        if (err instanceof SyncStopped) {
          setState({ isSyncing: false });
          return;
        }
        console.warn(err);
        setState({ isSyncing: false, error: describe(err) });
      }
    })
    .then(() => undefined);
  queued = run;
  return run;
}

/** A sync under way: what stops it, and the settings it syncs with */
interface SyncContext {
  signal: AbortSignal;
  settings: DriveSettings;
}

async function sync(signal: AbortSignal) {
  const settings = await settingsItem.getValue();
  if (!settings) return;
  await checkDataConsent();
  const ctx: SyncContext = { signal, settings };
  const local = await getSynced();
  const localHash = await hash(serializeSynced(local));
  const files = await listFiles(ctx);

  // Unchanged here and in Drive since the last sync: nothing to do
  if (
    files.length === 1 &&
    files[0]!.id === settings.fileId &&
    files[0]!.version === settings.version &&
    localHash === settings.syncedHash
  ) {
    return finish(files[0]!, localHash, ctx);
  }

  // Normally one file, but two devices syncing for the first time at once can
  // each create one: merge them all into the oldest. Another device doing the
  // same may delete one meanwhile.
  const downloads = await Promise.all(
    files.map(async (file) => ({ file, text: await download(file.id, ctx) })),
  );
  const remotes = downloads.flatMap(({ file, text }) =>
    text === undefined ? [] : [{ file, synced: readRemote(text) }],
  );
  const now = Date.now();
  const merged = remotes.reduce(
    (a, { synced }) => (synced ? mergeSynced(a, synced, now) : a),
    local,
  );
  if (!sameSynced(merged, local)) {
    // Merged again with the groups as they are now, which may have changed
    // while Drive was being asked.
    await updateSynced((current) => {
      signal.throwIfAborted();
      return mergeSynced(current, merged, now);
    });
  }
  const result = await getSynced();
  const text = serializeSynced(result);

  const [first, ...duplicates] = remotes;
  let file = first?.file;
  if (!file) {
    file = await createFile(text, ctx);
  } else if (duplicates.length || !first!.synced || !sameSynced(result, first!.synced)) {
    file = { id: file.id, version: await updateFile(file.id, text, ctx) };
  }
  await Promise.all(duplicates.map(({ file }) => deleteFile(file.id, ctx)));
  return finish(file, await hash(text), ctx);
}

/**
 * The groups and deletions in a sync file, or undefined if it can't be read,
 * e.g. left empty by an upload cut short, which syncing then replaces. Throws
 * if saved by a newer version of yt3k, which mustn't be replaced.
 */
function readRemote(text: string): Synced | undefined {
  try {
    return parseSynced(text);
  } catch (err) {
    if (err instanceof NewerFormatError) throw err;
    console.warn('yt3k: replacing the unreadable sync file in Google Drive', err);
    return undefined;
  }
}

async function finish(file: DriveFile, syncedHash: string, { signal, settings }: SyncContext) {
  await navigator.locks.request(ACCOUNT_LOCK, async () => {
    signal.throwIfAborted();
    const current = await settingsItem.getValue();
    // Turned off meanwhile, e.g. in another tab, maybe on with another account
    if (!isConnection(current, settings)) return;
    await settingsItem.setValue({
      ...current,
      fileId: file.id,
      version: file.version,
      syncedHash,
      syncedAt: Date.now(),
    });
  });
}

/**
 * Asks the user to sign in to Google and allow yt3k its Drive folder, then
 * turns sync on with that account. Throws if they don't. Does nothing if
 * turned on meanwhile, e.g. in another tab.
 */
export async function connectDrive() {
  // First, while still handling the click, as Firefox requires
  const consenting = requestDataConsent();
  const { signal } = session;
  if (!(await consenting)) throw new ConsentError(CONSENT_NEEDED);
  if (!(await authorizeUnlessStopped({ interactive: true, expected: null, signal }))) return;
  await syncNow();
}

/**
 * Asks Firefox again to allow sending the groups to Google Drive, e.g. after
 * the user revoked it, then syncs. Call while handling a click.
 */
export async function allowDataSending() {
  if (await requestDataConsent()) await syncNow();
}

/**
 * Signs in again after Google stopped renewing the token, with the account
 * synced with, then syncs. Throws if that doesn't happen. Does nothing if sync
 * is turned off meanwhile, even if then on again.
 */
export async function reconnectDrive() {
  const { signal } = session;
  const settings = await settingsItem.getValue();
  if (!settings) return;
  if (!(await authorizeUnlessStopped({ interactive: true, expected: settings, signal }))) return;
  await syncNow();
}

/** Whether signed in, rather than stopped by sync turned off or on meanwhile */
async function authorizeUnlessStopped(options: Parameters<typeof authorize>[0]) {
  try {
    await authorize(options);
    return true;
  } catch (err) {
    if (err instanceof SyncStopped) return false;
    throw err;
  }
}

/**
 * Turns sync off in this browser, stopping a sync under way. The groups stay
 * here, and in Drive for other devices still syncing. Doesn't revoke yt3k's
 * access: Google would revoke it for every browser signed in with the same
 * client, not just this one.
 */
export async function disconnectDrive() {
  stopSyncing();
  await navigator.locks.request(ACCOUNT_LOCK, async () => {
    await settingsItem.setValue(null);
    await tokenItem.setValue(null);
  });
  showSettings(null);
}

/**
 * Where Google sends the user back to after signing in, which the OAuth client
 * must list. It depends on the extension ID, so differs between Chrome-based
 * browsers and Firefox, and for the dev builds.
 */
export function redirectUri(): string {
  return browser.identity.getRedirectURL();
}

/**
 * The data Firefox asks the user to allow sending, as declared optional in
 * wxt.config.ts: the groups' names and channels, sent to their Google Drive.
 * Other browsers don't ask.
 */
const DATA_COLLECTION = ['websiteActivity'];

const CONSENT_NEEDED = 'Allow yt3k to send your groups to your Google Drive, so it can sync them';

/** Firefox doesn't allow sending the groups */
class ConsentError extends Error {}

/**
 * Asks Firefox to allow sending the groups, unless already allowed, and
 * resolves whether it is. Call while handling a click, before awaiting
 * anything: Firefox only asks then.
 */
function requestDataConsent(): Promise<boolean> {
  if (import.meta.env.BROWSER !== 'firefox') return Promise.resolve(true);
  return browser.permissions.request({ data_collection: DATA_COLLECTION } as Parameters<
    typeof browser.permissions.request
  >[0]);
}

/**
 * Throws ConsentError if Firefox doesn't allow sending the groups: never
 * allowed, as by builds from before it asked, or allowed and since revoked in
 * about:addons, which it doesn't tell of otherwise.
 */
async function checkDataConsent() {
  if (import.meta.env.BROWSER !== 'firefox') return;
  const { data_collection: allowed } = (await browser.permissions.getAll()) as {
    data_collection?: string[];
  };
  // A Firefox without the consent to ask for
  if (!allowed) return;
  if (!DATA_COLLECTION.every((type) => allowed.includes(type))) {
    throw new ConsentError(CONSENT_NEEDED);
  }
}

/** Google couldn't be reached */
class OfflineError extends Error {}

/** Signing in didn't happen, or Google won't renew the token without asking */
class SignInError extends Error {}

/** Signed in with another account than the one synced with */
class WrongAccountError extends SignInError {}

/** Google Drive answered with an error */
class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Account {
  /** Drive's ID for the account, which doesn't change */
  id: string;
  email?: string;
}

/**
 * Signs in and keeps the token, turning sync on with that account if
 * `expected` is null, or as the account of `expected`, the settings sync is
 * on with. Throws if signed in with another account, and SyncStopped if sync
 * isn't as expected any more, e.g. turned off and on again with another
 * account, maybe in another tab, while Google was being asked.
 */
async function authorize({
  interactive,
  expected,
  signal,
}: {
  interactive: boolean;
  expected: DriveSettings | null;
  signal: AbortSignal;
}): Promise<Token> {
  const signedIn = await signIn({ interactive, loginHint: expected?.email });
  signal.throwIfAborted();
  const account = await fetchAccount(signedIn.value, signal);
  if (expected?.accountId && account.id !== expected.accountId) {
    throw new WrongAccountError(
      `Signed in as ${account.email ?? 'another Google account'}, but groups sync with ${expected.email ?? 'another one'}. Sign in with that account, or turn sync off and connect again.`,
    );
  }
  const token: Token = { ...signedIn, accountId: account.id };
  await navigator.locks.request(ACCOUNT_LOCK, async () => {
    signal.throwIfAborted();
    const current = await settingsItem.getValue();
    if (!isConnection(current, expected)) {
      throw new SyncStopped(expected ? 'Sync was turned off' : 'Sync was turned on meanwhile');
    }
    await tokenItem.setValue(token);
    // Learns the account, for settings from before it was kept, and its email
    // anew, which may have changed
    const settings: DriveSettings = {
      ...current,
      accountId: account.id,
      email: account.email ?? current?.email,
    };
    if (settings.accountId !== current?.accountId || settings.email !== current?.email) {
      await settingsItem.setValue(settings);
      showSettings(settings);
    }
  });
  return token;
}

/**
 * Whether `current`, the settings now, are still those of the connection
 * `expected` was read from: both off, or on with the same account. Connecting
 * always learns the account, so settings from before it was kept can only
 * be the same connection as each other.
 */
function isConnection(current: DriveSettings | null, expected: DriveSettings | null): boolean {
  return current && expected ? current.accountId === expected.accountId : current === expected;
}

/** Asks Google for a token, without keeping it. */
async function signIn({
  interactive,
  loginHint,
}: {
  interactive: boolean;
  loginHint?: string;
}): Promise<Token> {
  const stateParam = crypto.randomUUID();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state: stateParam,
    // The first time, let the user pick which account, which needn't be the
    // one they use YouTube with. Renewing, ask nothing.
    ...(!interactive && { prompt: 'none' }),
    ...(interactive && !loginHint && { prompt: 'select_account' }),
    ...(loginHint && { login_hint: loginHint }),
  }).toString();

  let redirect: string | undefined;
  try {
    redirect = await browser.identity.launchWebAuthFlow({ url: url.href, interactive });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Also how it fails when Google's page doesn't load
    if (!(await canReachGoogle())) throw new OfflineError(message);
    throw new SignInError(message);
  }
  const params = new URLSearchParams(new URL(redirect ?? 'about:blank').hash.slice(1));
  if (params.get('state') !== stateParam) throw new SignInError('Google sign-in was cancelled');
  const error = params.get('error');
  if (error) throw new SignInError(`Google sign-in failed: ${error}`);
  const value = params.get('access_token');
  // Google lets the user untick the Drive permission on the consent screen.
  if (!value || !params.get('scope')?.split(' ').includes(SCOPE)) {
    throw new SignInError('yt3k needs access to its own folder in Google Drive to sync');
  }
  const expiresIn = Number(params.get('expires_in')) || 3600;
  return { value, expiresAt: Date.now() + expiresIn * 1000 };
}

/** Whether Google answers at all, to tell being offline from being signed out */
async function canReachGoogle(): Promise<boolean> {
  try {
    await fetch(`${DRIVE}/about`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
    return true;
  } catch {
    return false;
  }
}

/**
 * A token for the account the sync is with, renewed if the one kept is about
 * to expire, is `refused`, or is for another account: one kept by a sign-in
 * since, e.g. after sync was turned off and on again in another tab.
 */
async function getToken({ signal, settings }: SyncContext, refused?: string): Promise<string> {
  const token = await tokenItem.getValue();
  if (
    token &&
    token.value !== refused &&
    token.accountId === settings.accountId &&
    token.expiresAt - 60_000 > Date.now()
  ) {
    return token.value;
  }
  // Turned off meanwhile, maybe in another tab: no point asking Google, which
  // authorize checks again once it has
  const current = await settingsItem.getValue();
  signal.throwIfAborted();
  if (!isConnection(current, settings)) throw new SyncStopped('Sync was turned off');
  // Without knowing the account, renewing could switch to another one
  if (!settings.accountId) throw new SignInError('Signing in again tells which account to sync');
  return (await authorize({ interactive: false, expected: settings, signal })).value;
}

/** A request to Google's API, signing in again once if the token was refused */
async function api(
  url: string,
  ctx: SyncContext,
  init: RequestInit = {},
  refused?: string,
): Promise<Response> {
  const token = await getToken(ctx, refused);
  try {
    return await request(url, token, { ...init, signal: ctx.signal });
  } catch (err) {
    if (err instanceof DriveError && err.status === 401 && refused === undefined) {
      return api(url, ctx, init, token);
    }
    throw err;
  }
}

/** A request to Google's API with the given token */
async function request(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (err) {
    if (init.signal?.aborted) throw init.signal.reason;
    throw new OfflineError(String(err));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new DriveError(
      response.status,
      `Google Drive answered ${response.status}${body?.error?.message ? `: ${body.error.message}` : ''}`,
    );
  }
  return response;
}

interface DriveFile {
  id: string;
  version: string;
}

/** The sync files in the app data folder, oldest first */
async function listFiles(ctx: SyncContext): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}' and trashed = false`,
    orderBy: 'createdTime',
    fields: 'files(id,version)',
    pageSize: '10',
  });
  const response = await api(`${DRIVE}/files?${params}`, ctx);
  return ((await response.json()) as { files: DriveFile[] }).files;
}

/** The file's content, or undefined if it's gone */
async function download(id: string, ctx: SyncContext): Promise<string | undefined> {
  try {
    return await (await api(`${DRIVE}/files/${id}?alt=media`, ctx)).text();
  } catch (err) {
    if (err instanceof DriveError && err.status === 404) return undefined;
    throw err;
  }
}

/** Creates the sync file and returns its ID and version. */
async function createFile(text: string, ctx: SyncContext): Promise<DriveFile> {
  // Revoked since the sync started, maybe while Drive was being asked
  await checkDataConsent();
  const boundary = crypto.randomUUID();
  const metadata = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    text,
    `--${boundary}--`,
  ].join('\r\n');
  const response = await api(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, ctx, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await response.json()) as DriveFile;
}

/** Replaces the sync file's content and returns its new version. */
async function updateFile(id: string, text: string, ctx: SyncContext): Promise<string> {
  // Revoked since the sync started, maybe while Drive was being asked
  await checkDataConsent();
  const response = await api(`${UPLOAD}/files/${id}?uploadType=media&fields=version`, ctx, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: text,
  });
  return ((await response.json()) as DriveFile).version;
}

/** Deletes the file, if another device didn't already */
async function deleteFile(id: string, ctx: SyncContext) {
  try {
    await api(`${DRIVE}/files/${id}`, ctx, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof DriveError && err.status === 404)) throw err;
  }
}

/** The account the token is for */
async function fetchAccount(token: string, signal: AbortSignal): Promise<Account> {
  const response = await request(`${DRIVE}/about?fields=user(permissionId,emailAddress)`, token, {
    signal,
  });
  const { user } = (await response.json()) as {
    user?: { permissionId?: string; emailAddress?: string };
  };
  if (!user?.permissionId) throw new Error("Google didn't tell which account signed in");
  return { id: user.permissionId, email: user.emailAddress };
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function describe(err: unknown): DriveSyncState['error'] {
  if (err instanceof WrongAccountError) return { message: err.message, needsSignIn: true };
  if (err instanceof SignInError) {
    return { message: 'Sign in to Google again to keep syncing', needsSignIn: true };
  }
  if (err instanceof ConsentError) {
    return { message: err.message, needsSignIn: false, needsConsent: true };
  }
  if (err instanceof NewerFormatError) {
    return {
      message:
        'Your groups in Google Drive were saved by a newer version of yt3k: update it to sync',
      needsSignIn: false,
    };
  }
  if (err instanceof OfflineError) {
    return { message: "Couldn't reach Google Drive", needsSignIn: false };
  }
  return { message: err instanceof Error ? err.message : String(err), needsSignIn: false };
}
