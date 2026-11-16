/** "1,200", or "no limit" when the plan has none. */
export function formatLimit(limit: number | null): string {
  return limit === null ? 'no limit' : limit.toLocaleString('en-IN');
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "5 minutes ago" up to a week, then a plain date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const absolute = Math.abs(seconds);
  if (absolute >= 7 * 86_400) {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  for (const [unit, size] of UNITS) {
    if (absolute >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}
