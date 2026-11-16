import { Hand, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/button';
import type { TimelineStep } from '@/features/chat/StepsTimeline';
import { StepsTimeline } from '@/features/chat/StepsTimeline';
import { apiErrorMessage } from '@/lib/api';
import type { Run, RunStep } from '@/lib/types';
import { useGetRunQuery, useResumeRunMutation } from './api';
import { RunStatusBadge } from './RunStatusBadge';

const POLL_MS = 1000;

function toTimeline(step: RunStep, index: number): TimelineStep {
  return {
    id: `${step.nodeId}-${index}`,
    name: step.label || step.nodeId,
    kind: step.nodeType,
    status:
      step.status === 'running'
        ? 'running'
        : step.status === 'waiting_approval'
          ? 'waiting'
          : 'done',
    isError: step.status === 'failed',
    input: step.input,
    output: step.output,
    error: step.error,
  };
}

function isActive(run: Run | undefined): boolean {
  return run?.status === 'running' || run?.status === 'pending';
}

function ApprovalCard({ run }: { run: Run }) {
  const [resume, state] = useResumeRunMutation();
  const waiting = run.steps.findLast((step) => step.status === 'waiting_approval');
  const message = (waiting?.input as { message?: string } | undefined)?.message;

  const decide = async (approved: boolean) => {
    try {
      await resume({ id: run.id, approved }).unwrap();
    } catch (failure) {
      toast.error(apiErrorMessage(failure));
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-warning/50 bg-warning/10 p-3">
      <p className="flex items-start gap-2 font-medium">
        <Hand className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {message ?? 'This run is waiting for your approval.'}
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={state.isLoading} onClick={() => void decide(true)}>
          {state.isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={state.isLoading}
          onClick={() => void decide(false)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Shows a run as it progresses. Polls while it works, and stops once it finishes or pauses. */
export function RunPanel({ runId }: { runId: string }) {
  const [polling, setPolling] = useState(true);
  const { data: run, error } = useGetRunQuery(runId, {
    pollingInterval: polling ? POLL_MS : 0,
    skipPollingIfUnfocused: false,
    refetchOnMountOrArgChange: true,
  });

  // Resuming invalidates this run, which refetches it and turns polling back on.
  useEffect(() => {
    setPolling(!run || isActive(run));
  }, [run]);

  const steps = useMemo(() => run?.steps.map(toTimeline) ?? [], [run?.steps]);

  if (error) return <Alert tone="error">{apiErrorMessage(error)}</Alert>;
  if (!run) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Starting the run
      </p>
    );
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-semibold">This run</h3>
        <RunStatusBadge status={run.status} />
      </div>
      <StepsTimeline steps={steps} />
      {run.status === 'waiting_approval' && <ApprovalCard run={run} />}
      {run.status === 'failed' && (
        <Alert tone="error" title="The run failed">
          {run.error ?? 'A step failed. Open it above to see why.'}
        </Alert>
      )}
      {run.status === 'succeeded' && typeof run.output === 'string' && run.output && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Result</p>
          <p className="rounded-md bg-muted p-3 text-sm break-words whitespace-pre-wrap">
            {run.output}
          </p>
        </div>
      )}
      {isActive(run) && steps.length === 0 && (
        <p className="text-sm text-muted-foreground">Waiting for the first step.</p>
      )}
    </div>
  );
}
