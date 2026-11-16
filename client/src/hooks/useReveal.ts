import { useEffect, useRef } from 'react';

/**
 * Marks every `[data-reveal]` element inside the returned container as visible the first time it
 * scrolls into view. The transition itself lives in index.css.
 */
export function useReveal<T extends HTMLElement>() {
  const container = useRef<T>(null);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((target) => target.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return container;
}
