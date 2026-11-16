import { CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MCP_META, NODE_META } from '@/lib/nodeMeta';
import type { WorkflowNodeType } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface TimelineStep {
  id: string;
  name: string;
  /** A workflow node type. Chat tool calls leave this out. */
  kind?: string;
  status: 'running' | 'done' | 'waiting';
  isError?: boolean;
  input?: unknown;
  output?: unknown;
  error?: string;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function metaFor(step: TimelineStep) {
  if (step.name.startsWith('mcp:')) return MCP_META;
  if (step.kind && step.kind in NODE_META) return NODE_META[step.kind as WorkflowNodeType];
  return { icon: Wrench, color: 'var(--node-tool)', textClass: 'text-node-tool' };
}

function StatusIcon({ step }: { step: TimelineStep }) {
  if (step.status === 'running') {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Running" />;
  }
  if (step.status === 'waiting') {
    return <span className="text-xs font-medium text-warning">Waiting for you</span>;
  }
  return step.isError ? (
    <XCircle className="size-4 text-danger" aria-label="Failed" />
  ) : (
    <CheckCircle2 className="size-4 text-success" aria-label="Finished" />
  );
}

function ValueBlock({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre
        className={cn(
          'max-h-64 overflow-auto rounded-md bg-muted p-2.5 font-mono text-xs break-words whitespace-pre-wrap',
          danger && 'text-danger',
        )}
      >
        {value}
      </pre>
    </div>
  );
}

function StepRow({ step, last }: { step: TimelineStep; last: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = metaFor(step);
  const Icon = meta.icon;
  const input = formatValue(step.input);
  const output = formatValue(step.output);
  const hasDetails = Boolean(input || output || step.error);

  return (
    <li className="relative pl-8">
      {/* The cable joining this step to the next one. */}
      {!last && (
        <span
          aria-hidden
          className="absolute top-7 bottom-0 left-[11px] w-0.5 rounded-full"
          style={{ backgroundColor: meta.color, opacity: 0.45 }}
        />
      )}
      <span
        aria-hidden
        className="absolute top-1.5 left-0 flex size-6 items-center justify-center rounded-full bg-muted"
      >
        <Icon className={cn('size-3.5', meta.textClass)} />
      </span>

      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={hasDetails ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-9 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors duration-150 enabled:hover:bg-muted"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{step.name}</span>
        <StatusIcon step={step} />
        {hasDetails && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-150',
              open && 'rotate-90',
            )}
          />
        )}
      </button>

      {open && (
        <div className="space-y-2 px-1.5 pt-1 pb-3">
          {input && <ValueBlock label="Input" value={input} />}
          {output && <ValueBlock label="Output" value={output} danger={step.isError} />}
          {step.error && <ValueBlock label="Error" value={step.error} danger />}
        </div>
      )}
    </li>
  );
}

/** The record of what an agent did. Inputs and outputs stay collapsed until asked for. */
export function StepsTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Agent steps" className={cn('space-y-1', className)}>
      {steps.map((step, index) => (
        <StepRow key={step.id} step={step} last={index === steps.length - 1} />
      ))}
    </ol>
  );
}

/** A timeline that folds to one line, so a long run does not push the reply off screen. */
export function CollapsibleSteps({
  steps,
  defaultOpen = false,
}: {
  steps: TimelineStep[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;

  const failed = steps.filter((step) => step.isError).length;
  const running = steps.some((step) => step.status === 'running');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex min-h-9 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground">
        <ChevronRight
          aria-hidden
          className={cn('size-4 shrink-0 transition-transform duration-150', open && 'rotate-90')}
        />
        {running ? 'Using' : 'Used'} {steps.length} {steps.length === 1 ? 'tool' : 'tools'}
        {failed > 0 && <span className="font-medium text-danger">, {failed} failed</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <StepsTimeline steps={steps} className="pt-1" />
      </CollapsibleContent>
    </Collapsible>
  );
}
