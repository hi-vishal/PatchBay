import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  error: { icon: XCircle, className: 'border-danger/40 bg-danger/10 text-danger' },
  warning: { icon: AlertTriangle, className: 'border-warning/40 bg-warning/10 text-warning' },
  success: { icon: CheckCircle2, className: 'border-success/40 bg-success/10 text-success' },
};

export function Alert({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof tones;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = tones[tone];
  return (
    <div
      role="alert"
      className={cn('flex gap-3 rounded-md border p-3 text-sm', toneClass, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 text-foreground">
        {title && <p className="font-medium">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
