import { CheckCircle2, Clock, Hand, Loader2, XCircle } from 'lucide-react';
import type { RunStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS: Record<RunStatus, { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: 'Queued', icon: Clock, className: 'text-muted-foreground' },
  running: { label: 'Running', icon: Loader2, className: 'text-link' },
  waiting_approval: { label: 'Needs approval', icon: Hand, className: 'text-warning' },
  succeeded: { label: 'Finished', icon: CheckCircle2, className: 'text-success' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-danger' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 text-sm font-medium', className)}
    >
      <Icon className={cn('size-4', status === 'running' && 'animate-spin')} aria-hidden />
      {label}
    </span>
  );
}
