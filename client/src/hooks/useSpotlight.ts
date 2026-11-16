import { useEffect, useRef } from 'react';

/**
 * Feeds the pointer position to every `.spotlight` inside the returned container as `--mx` and
 * `--my`. It writes straight to the element's style, once per frame, so nothing re-renders.
 */
export function useSpotlight<T extends HTMLElement>() {
  const container = useRef<T>(null);

  useEffect(() => {
    const root = container.current;
    if (!root || !window.matchMedia('(hover: hover)').matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.spotlight');
        if (!target) return;
        const box = target.getBoundingClientRect();
        target.style.setProperty('--mx', `${event.clientX - box.left}px`);
        target.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
    };
    root.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      root.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return container;
}
