import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { BoardCable } from './board';
import { CABLES, MODULES, MODULE_HEIGHT, MODULE_WIDTH, jackPosition, moduleById } from './board';

const PatchBoardScene = lazy(() => import('./PatchBoardScene'));

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function cablePath({ from, to, sag }: BoardCable): string {
  const a = moduleById(from);
  const b = moduleById(to);
  const start = jackPosition(a, b);
  const end = jackPosition(b, a);
  const middle = (start.y + end.y) / 2 - sag * 2;
  return `M ${start.x} ${-start.y} Q ${(start.x + end.x) / 2} ${-middle} ${end.x} ${-end.y}`;
}

/** Same board, flat. Shown while the 3D loads, and instead of it for reduced motion or no WebGL. */
function StaticBoard({ className }: { className?: string }) {
  return (
    <svg viewBox="-6.2 -4 12.4 8" className={className} aria-hidden>
      {CABLES.map((cable) => (
        <path
          key={`${cable.from}-${cable.to}`}
          d={cablePath(cable)}
          fill="none"
          stroke={cable.color}
          strokeWidth="0.09"
          strokeLinecap="round"
        />
      ))}
      {MODULES.map((module) => (
        <g key={module.id}>
          <rect
            x={module.x - MODULE_WIDTH / 2}
            y={-module.y - MODULE_HEIGHT / 2}
            width={MODULE_WIDTH}
            height={MODULE_HEIGHT}
            rx="0.08"
            fill={module.color}
          />
          <text
            x={module.x}
            y={-module.y + 0.13}
            textAnchor="middle"
            fontSize="0.36"
            fontWeight="600"
            fontFamily="var(--font-display)"
            fill={module.ink}
          >
            {module.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Starts with the flat board, then swaps in the 3D scene once the browser is idle, which keeps
 * the first paint fast. The scene stops rendering whenever it scrolls out of view.
 */
export function PatchBoard({ className }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [mount3d, setMount3d] = useState(false);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !supportsWebGl()) return;

    let cancelled = false;
    const start = () => {
      void document.fonts
        .load('600 76px "Archivo Variable"')
        .catch(() => undefined)
        .then(() => {
          if (!cancelled) setMount3d(true);
        });
    };
    const idle = window.requestIdleCallback?.(start, { timeout: 1500 });
    const timer = idle === undefined ? window.setTimeout(start, 300) : undefined;
    return () => {
      cancelled = true;
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className={cn('relative', className)}>
      <StaticBoard
        className={cn(
          'absolute inset-0 m-auto size-full max-h-full p-4 transition-opacity duration-700',
          ready && 'opacity-0',
        )}
      />
      {mount3d && (
        <div
          className={cn(
            'absolute inset-0 transition-opacity duration-700',
            ready ? 'opacity-100' : 'opacity-0',
          )}
        >
          <Suspense fallback={null}>
            <PatchBoardScene active={inView} onReady={() => setReady(true)} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
