import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { connectDrive, disconnectDrive, reconnectDrive, syncNow } from './drive';
import { addShow, getSyncedShows } from '../podcasts/shows';
import { type Group, getSynced } from './groups';
import { parseSyncData, serializeSyncData } from './sync';

const music: Group = { id: 'a', name: 'Music', color: 'red', channelIds: ['UC1'], updatedAt: 1 };
const news: Group = { id: 'b', name: 'News', color: 'blue', channelIds: ['UC2'], updatedAt: 1 };

interface MockFile {
  id: string;
  version: string;
  /** The groups it holds, or its raw content */
  content: Group[] | string;
  /** Deleted by another device after being listed, or after being downloaded */
  isGone?: 'listed' | 'downloaded';
}

/** Drive's app data folder holding these files; returns the requests made */
function mockDrive(
  files: MockFile[],
  {
    account = 'me',
    accounts = {},
    beforeList,
    beforeAbout,
  }: {
    account?: string;
    /** The account each token is for, if not `account` */
    accounts?: Record<string, string>;
    beforeList?: () => Promise<void>;
    /** Waited for before telling the account of the token */
    beforeAbout?: (token: string) => Promise<void>;
  } = {},
) {
  const requests: { method: string; path: string; token: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? 'GET';
      const token = new Headers(init?.headers).get('Authorization')?.replace('Bearer ', '') ?? '';
      requests.push({ method, path: url.pathname, token, body: init?.body as string | undefined });
      if (url.pathname === '/drive/v3/about') {
        await beforeAbout?.(token);
        const id = accounts[token] ?? account;
        return Response.json({ user: { permissionId: id, emailAddress: `${id}@x` } });
      }
      if (url.pathname === '/drive/v3/files' && method === 'GET') {
        await beforeList?.();
        return Response.json({ files: files.map(({ id, version }) => ({ id, version })) });
      }
      const file = files.find((f) => url.pathname.endsWith(`/files/${f.id}`));
      if (!file) throw new Error(`Unexpected request: ${method} ${input}`);
      if (file.isGone === 'listed' || (file.isGone && method === 'DELETE')) {
        return Response.json({ error: { message: 'Not found' } }, { status: 404 });
      }
      if (method === 'GET') {
        const { content } = file;
        return new Response(
          typeof content === 'string'
            ? content
            : serializeSyncData({
                groups: { groups: content, deleted: {} },
                shows: { shows: [], deleted: {} },
              }),
        );
      }
      if (method === 'PATCH') return Response.json({ version: file.version + '+' });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${method} ${input}`);
    }),
  );
  return requests;
}

const settings = () =>
  storage.getItem<{ accountId?: string; syncedAt?: number }>('local:driveSync');

/** Google's sign-in handing out each of these tokens in turn */
function mockSignIn(...tokens: string[]) {
  vi.spyOn(browser.identity, 'getRedirectURL').mockReturnValue('https://x.chromiumapp.org/');
  const flow = vi.spyOn(browser.identity, 'launchWebAuthFlow');
  for (const token of tokens) {
    flow.mockImplementationOnce(async ({ url }) => {
      const state = new URL(url).searchParams.get('state');
      const scope = 'https://www.googleapis.com/auth/drive.appdata';
      return `https://x.chromiumapp.org/#access_token=${token}&scope=${scope}&state=${state}`;
    });
  }
}

describe('syncNow', () => {
  beforeEach(async () => {
    // Node grants a free lock at once, where browsers do in a later task as
    // the Web Locks spec says, and syncNow relies on. Each lock is held by
    // one at a time, in the order asked for.
    const held = new Map<string, Promise<unknown>>();
    vi.stubGlobal('navigator', {
      locks: {
        request: (name: string, callback: () => Promise<unknown>) => {
          const run = (held.get(name) ?? Promise.resolve())
            .then(() => new Promise((resolve) => setTimeout(resolve)))
            .then(callback);
          held.set(name, run.catch(() => undefined));
          return run;
        },
      },
    });
    await storage.setItem('local:driveSync', { accountId: 'me', email: 'me@x' });
    await storage.setItem('local:driveToken', {
      value: 't',
      expiresAt: Date.now() + 3600_000,
      accountId: 'me',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fakeBrowser.reset();
  });

  it('downloads a file replacing the one last synced, even at the same version', async () => {
    mockDrive([{ id: 'original', version: '1', content: [music] }]);
    await syncNow();
    expect((await getSynced()).groups.map((g) => g.id)).toEqual(['a']);

    // E.g. the app data deleted, and another device creating the file again
    mockDrive([{ id: 'replacement', version: '1', content: [music, news] }]);
    await syncNow();
    expect((await getSynced()).groups.map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('carries on when another device deleted a duplicate file first', async () => {
    for (const isGone of ['listed', 'downloaded'] as const) {
      await storage.setItem('local:driveSync', { accountId: 'me', email: 'me@x' });
      const requests = mockDrive([
        { id: 'first', version: '1', content: [music] },
        { id: 'second', version: '1', content: [news], isGone },
      ]);
      await syncNow();
      expect((await settings())?.syncedAt).toBeDefined();
      expect(requests.filter((r) => r.method === 'DELETE').length).toBe(
        isGone === 'listed' ? 0 : 1,
      );
    }
  });

  it('replaces a file it cannot read', async () => {
    const requests = mockDrive([{ id: 'broken', version: '1', content: '' }]);
    await syncNow();
    const patch = requests.find((r) => r.method === 'PATCH');
    expect(parseSyncData(patch!.body!).groups).toEqual(await getSynced());
    expect((await settings())?.syncedAt).toBeDefined();
  });

  it('merges the podcasts followed here with those followed elsewhere', async () => {
    const here = 'https://example.com/here.xml';
    const there = { feedUrl: 'https://example.org/there.xml', title: 'There', updatedAt: 1 };
    await addShow({ feedUrl: here, title: 'Here' });
    const content = serializeSyncData({
      groups: { groups: [music], deleted: {} },
      shows: { shows: [there], deleted: {} },
    });
    const requests = mockDrive([{ id: 'file', version: '1', content }]);
    await syncNow();
    expect((await getSyncedShows()).shows.map((s) => s.feedUrl)).toEqual([here, there.feedUrl]);
    const patch = requests.find((r) => r.method === 'PATCH');
    const uploaded = parseSyncData(patch!.body!);
    expect(uploaded.shows.shows.map((s) => s.feedUrl)).toEqual([here, there.feedUrl]);
    expect(uploaded.groups.groups.map((g) => g.id)).toContain('a');
  });

  it("doesn't renew the token for another account", async () => {
    await storage.setItem('local:driveToken', null);
    mockSignIn('other');
    const requests = mockDrive([{ id: 'theirs', version: '1', content: [news] }], {
      account: 'someone-else',
    });
    await syncNow();
    expect(await storage.getItem('local:driveToken')).toBeNull();
    expect(requests.map((r) => r.path)).toEqual(['/drive/v3/about']);
    expect((await settings())?.syncedAt).toBeUndefined();
  });

  it('stops syncing when sync is turned off meanwhile', async () => {
    const requests = mockDrive([{ id: 'file', version: '1', content: [music, news] }], {
      beforeList: () => disconnectDrive(),
    });
    await syncNow();
    expect(requests.map((r) => r.method)).toEqual(['GET']);
    expect(await settings()).toBeNull();
    expect(await storage.getItem('local:driveToken')).toBeNull();
  });

  it("doesn't go on with another account's token when switched in another tab", async () => {
    await storage.setItem('local:driveSync', { accountId: 'a', email: 'a@x' });
    await storage.setItem('local:driveToken', {
      value: 'a-token',
      expiresAt: Date.now() + 3600_000,
      accountId: 'a',
    });
    mockSignIn('a-renewed');
    const requests = mockDrive([{ id: 'as-file', version: '1', content: [music] }], {
      accounts: { 'a-token': 'a', 'a-renewed': 'a', 'b-token': 'b' },
      // Another tab turning sync off and on with account b, as the sync lists
      beforeList: async () => {
        await storage.setItem('local:driveSync', null);
        await storage.setItem('local:driveSync', { accountId: 'b', email: 'b@x' });
        await storage.setItem('local:driveToken', {
          value: 'b-token',
          expiresAt: Date.now() + 3600_000,
          accountId: 'b',
        });
      },
    });
    await syncNow();
    expect(requests.filter((r) => r.token === 'b-token')).toEqual([]);
    expect(await settings()).toEqual({ accountId: 'b', email: 'b@x' });
    expect(await storage.getItem('local:driveToken')).toMatchObject({ value: 'b-token' });
  });

  describe('signing in again while sync is turned off and on with another account', () => {
    /**
     * Signs in again as `a`, whose account Google tells only once `switchAccount`
     * turned sync off and on with `b` and that synced; returns the requests.
     */
    async function reconnectWhileSwitching(switchAccount: () => Promise<void>) {
      await storage.setItem('local:driveSync', { accountId: 'a', email: 'a@x' });
      await storage.setItem('local:driveToken', null);
      mockSignIn('old-token', 'new-token');
      let releaseA!: () => void;
      const aboutA = new Promise<void>((resolve) => (releaseA = resolve));
      let askedA!: () => void;
      const askedForA = new Promise<void>((resolve) => (askedA = resolve));
      const requests = mockDrive([{ id: 'bs-file', version: '1', content: [news] }], {
        accounts: { 'old-token': 'a', 'new-token': 'b' },
        beforeAbout: async (token) => {
          if (token !== 'old-token') return;
          askedA();
          await aboutA;
        },
      });

      const reconnecting = reconnectDrive();
      await askedForA;
      await switchAccount();
      expect((await getSynced()).groups.map((g) => g.id)).toContain('b');
      releaseA();
      await reconnecting;
      await syncNow();
      return requests;
    }

    async function expectStillB(requests: { path: string; token: string }[]) {
      expect((await settings())?.accountId).toBe('b');
      expect(await storage.getItem('local:driveToken')).toMatchObject({ value: 'new-token' });
      const withOldToken = requests.filter((r) => r.token === 'old-token');
      expect(withOldToken.map((r) => r.path)).toEqual(['/drive/v3/about']);
    }

    it('keeps the new account when switched here', async () => {
      const requests = await reconnectWhileSwitching(async () => {
        await disconnectDrive();
        await connectDrive();
      });
      await expectStillB(requests);
    });

    it('keeps the new account when switched in another tab', async () => {
      const requests = await reconnectWhileSwitching(async () => {
        // What another tab's disconnectDrive and connectDrive store
        await storage.setItem('local:driveSync', null);
        await storage.setItem('local:driveSync', { accountId: 'b', email: 'b@x' });
        await storage.setItem('local:driveToken', {
          value: 'new-token',
          expiresAt: Date.now() + 3600_000,
          accountId: 'b',
        });
        await syncNow();
      });
      await expectStillB(requests);
    });
  });

  describe('in Firefox', () => {
    /** Firefox allowing to send these kinds of data, in turn for each time asked */
    function mockConsent(...allowed: string[][]) {
      vi.stubEnv('BROWSER', 'firefox');
      const getAll = vi.spyOn(browser.permissions, 'getAll');
      for (const types of allowed) {
        getAll.mockResolvedValueOnce({ permissions: [], origins: [], data_collection: types } as never);
      }
      getAll.mockResolvedValue({ permissions: [], origins: [], data_collection: allowed.at(-1) } as never);
    }

    it('syncs once allowed to send the groups', async () => {
      mockConsent(['websiteActivity']);
      mockDrive([{ id: 'file', version: '1', content: [music, news] }]);
      await syncNow();
      expect((await settings())?.syncedAt).toBeDefined();
    });

    it("doesn't ask Google Drive anything until allowed", async () => {
      mockConsent([]);
      const requests = mockDrive([{ id: 'file', version: '1', content: [music, news] }]);
      await syncNow();
      expect(requests).toEqual([]);
      expect((await settings())?.syncedAt).toBeUndefined();
    });

    it("doesn't send the groups once revoked while syncing", async () => {
      // Allowed as the sync starts, revoked before it sends
      mockConsent(['websiteActivity'], []);
      const requests = mockDrive([{ id: 'file', version: '1', content: [news] }]);
      await syncNow();
      expect(requests.map((r) => r.method)).toEqual(['GET', 'GET']);
      expect((await settings())?.syncedAt).toBeUndefined();
    });

    it('asks before signing in, and connects only if allowed', async () => {
      await storage.setItem('local:driveSync', null);
      vi.stubEnv('BROWSER', 'firefox');
      const request = vi.spyOn(browser.permissions, 'request').mockResolvedValue(false as never);
      const signIn = vi.spyOn(browser.identity, 'launchWebAuthFlow');
      await expect(connectDrive()).rejects.toThrow('Allow yt3k');
      expect(request).toHaveBeenCalledWith({ data_collection: ['websiteActivity'] });
      expect(signIn).not.toHaveBeenCalled();
      expect(await settings()).toBeNull();
    });
  });
});
