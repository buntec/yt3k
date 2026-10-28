import { type RefObject, useEffect } from 'react';

/** "/" focuses the search bar, like on YouTube. */
export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}

/**
 * Folds case and diacritics, so that "delic" finds "Délicieuse". Applied to
 * both the query and the searched text.
 */
export function foldForSearch(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
