import { cn } from '@/lib/utils';

export const PRODUCT_NAME = 'Patchbay';

/** Two jacks joined by a sagging cable, which is the product in one picture. */
export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 24" className="h-[22px] w-[30px]" aria-hidden fill="none">
        <path
          d="M6 7c0 14 20 14 20 0"
          stroke="var(--signal)"
          strokeWidth="2.75"
          strokeLinecap="round"
        />
        <circle cx="6" cy="6" r="4.5" fill="currentColor" />
        <circle cx="26" cy="6" r="4.5" fill="currentColor" />
        <circle cx="6" cy="6" r="1.6" fill="var(--background)" />
        <circle cx="26" cy="6" r="1.6" fill="var(--background)" />
      </svg>
      {wordmark && (
        <span className="font-display text-[1.125rem] leading-none font-semibold">
          {PRODUCT_NAME}
        </span>
      )}
    </span>
  );
}
