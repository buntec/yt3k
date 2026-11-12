import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';

/**
 * A button that scrolls the list it's in back to the top, shown once the list
 * is scrolled down by more than a screen. Put it last in the list's column: it
 * floats centered at the bottom of the scroll area, taking no room of its own.
 */
export function BackToTop() {
  const ref = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [isShown, setIsShown] = useState(false);

  // The page's LayoutContent, or whatever else scrolls the list
  useEffect(() => {
    let el = ref.current?.parentElement ?? null;
    while (el && !['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) {
      el = el.parentElement;
    }
    setScroller(el);
  }, []);

  useEffect(() => {
    if (!scroller) return;
    const update = () => setIsShown(scroller.scrollTop > scroller.clientHeight);
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [scroller]);

  const scrollToTop = () => {
    if (!scroller) return;
    const isReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: 0, behavior: isReduced ? 'auto' : 'smooth' });
    // The button goes away at the top, so keyboard focus moves to the list
    // rather than back to the start of the page.
    scroller.focus({ preventScroll: true });
  };

  return (
    <div ref={ref} className="back-to-top">
      {isShown && (
        <Button
          label="Back to top"
          icon={<Icon icon={ArrowUp} />}
          elevation="med"
          onClick={scrollToTop}
        />
      )}
    </div>
  );
}
