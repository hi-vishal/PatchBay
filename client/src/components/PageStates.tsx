import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-6xl animate-rise space-y-8 px-4 py-6 sm:px-8 sm:py-10',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-6">
      <div className="min-w-0 space-y-1.5">
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold">{title}</h1>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="perf flex flex-col items-start gap-3 rounded-xl border border-dashed p-8">
      <span className="grid size-10 place-items-center rounded-lg border bg-card shadow-edge">
        <Icon className="size-5 text-signal" aria-hidden />
      </span>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="max-w-md text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Alert tone="error" title="This could not be loaded">
      <p>{apiErrorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Alert>
  );
}

export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** Explains a 402 from the API and offers the way forward. */
export function PlanLimitNotice({ error }: { error: unknown }) {
  if (apiErrorCode(error) !== 'PLAN_LIMIT_REACHED') return null;
  return (
    <Alert tone="warning" title="You have reached your plan limit">
      <p>{apiErrorMessage(error)}</p>
      <Button asChild size="sm" className="mt-2">
        <Link to="/app/billing">See plans</Link>
      </Button>
    </Alert>
  );
}
