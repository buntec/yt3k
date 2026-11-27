// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useArtwork } from './artwork';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let result: ReturnType<typeof useArtwork>;
function Probe({ sources, retryKey }: { sources: string[]; retryKey?: unknown }) {
  result = useArtwork(sources, retryKey);
  return null;
}

const root = createRoot(document.createElement('div'));
const render = (sources: string[], retryKey?: unknown) =>
  act(() => root.render(createElement(Probe, { sources, retryKey })));
const fail = () => act(() => result[1]());

afterEach(() => act(() => root.render(null)));

describe('useArtwork', () => {
  it('falls back source by source, then to nothing', async () => {
    await render(['a', 'b']);
    expect(result[0]).toBe('a');
    await fail();
    expect(result[0]).toBe('b');
    await fail();
    expect(result[0]).toBeUndefined();
  });

  it('remembers failures while the retry key stays', async () => {
    const key = {};
    await render(['a', 'b'], key);
    await fail();
    await render(['a', 'b'], key);
    expect(result[0]).toBe('b');
  });

  it('tries every source again under a new retry key', async () => {
    await render(['a', 'b'], {});
    await fail();
    await fail();
    expect(result[0]).toBeUndefined();
    await render(['a', 'b'], {});
    expect(result[0]).toBe('a');
    await fail();
    expect(result[0]).toBe('b');
  });
});
