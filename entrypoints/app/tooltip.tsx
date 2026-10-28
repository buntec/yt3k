import { useLayoutEffect, useRef, useState } from 'react';
import { useTooltip } from '@astryxdesign/core/Tooltip';

/**
 * Shows the `data-tooltip` text of any element on the page that the pointer
 * rests on. One tooltip that moves between elements, as an Astryx Tooltip on
 * each of hundreds of videos makes the page take many seconds to render, and
 * the browser's own (`title`) is slow to show and often doesn't.
 */
export function SharedTooltip() {
  const tooltip = useTooltip();
  const { ref } = tooltip;
  const [text, setText] = useState('');
  const anchor = useRef<HTMLElement | null>(null);

  // Runs again when the hook hands out a ref with new listeners, moving them
  // onto the element hovered.
  useLayoutEffect(() => {
    ref(anchor.current);
    // pointerover comes before the pointerenter and mouseenter the tooltip
    // listens for, so it catches those of the element it's moved to.
    const onPointerOver = (event: PointerEvent) => {
      const current = anchor.current;
      if (current && !current.isConnected) {
        // Removed while hovered, as by a search, so it never got the
        // mouseleave that hides its tooltip.
        current.dispatchEvent(new MouseEvent('mouseleave'));
        anchor.current = null;
      }
      const el = (event.target as Element).closest<HTMLElement>('[data-tooltip]');
      if (!el || el === anchor.current) return;
      anchor.current = el;
      setText(el.dataset.tooltip ?? '');
      ref(el);
    };
    document.addEventListener('pointerover', onPointerOver);
    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      ref(null);
    };
  }, [ref]);

  return tooltip.renderTooltip(text);
}
