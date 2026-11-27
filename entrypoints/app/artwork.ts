import { useState } from 'react';

const NONE_FAILED: ReadonlySet<string> = new Set();

/**
 * The first of `sources` that hasn't failed to load, best first, and the
 * handler to give the image's onError. Feeds can name artwork that's gone,
 * e.g. an episode's own, while the show's still loads. Undefined once all
 * failed, to show something else in its place.
 *
 * A new `retryKey` tries all of `sources` again, e.g. once the data they
 * came from was loaded anew.
 */
export function useArtwork(
  sources: readonly string[],
  retryKey?: unknown,
): [string | undefined, () => void] {
  const [failures, setFailures] = useState({ key: retryKey, failed: NONE_FAILED });
  const failed = failures.key === retryKey ? failures.failed : NONE_FAILED;
  const src = sources.find((source) => !failed.has(source));
  const onError = () => {
    if (!src) return;
    setFailures((prev) => ({
      key: retryKey,
      failed: new Set(prev.key === retryKey ? prev.failed : NONE_FAILED).add(src),
    }));
  };
  return [src, onError];
}
