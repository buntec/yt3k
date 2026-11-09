import { useState } from 'react';

/**
 * The first of `sources` that hasn't failed to load, best first, and the
 * handler to give the image's onError. Feeds can name artwork that's gone,
 * e.g. an episode's own, while the show's still loads. Undefined once all
 * failed, to show something else in its place.
 */
export function useArtwork(sources: readonly string[]): [string | undefined, () => void] {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const src = sources.find((source) => !failed.has(source));
  const onError = () => {
    if (src) setFailed((prev) => new Set(prev).add(src));
  };
  return [src, onError];
}
