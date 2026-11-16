import { cn } from '@/lib/utils';

/**
 * A segmented level meter, like the LED ladder on a mixing desk. The last few segments light in
 * the signal color, so a nearly used-up allowance stands out before the number is read.
 */
export function Meter({
  value,
  max,
  label,
  segments = 24,
  className,
}: {
  value: number;
  max: number;
  label: string;
  segments?: number;
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const lit = value > 0 ? Math.max(1, Math.round(ratio * segments)) : 0;
  const hot = Math.floor(segments * 0.84);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cn('flex h-2 gap-[3px]', className)}
    >
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className={cn(
            'flex-1 rounded-[2px] transition-colors duration-300',
            index >= lit ? 'bg-secondary' : index >= hot ? 'bg-signal' : 'bg-foreground/80',
          )}
        />
      ))}
    </div>
  );
}
