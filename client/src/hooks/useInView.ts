import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

/** True while the element is on screen. Looping demos use it to stop when nobody can see them. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}
