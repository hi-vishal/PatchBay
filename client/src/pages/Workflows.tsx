import { Loader2, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Alert } from '@/components/Alert';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageContainer,
  PageHeader,
  PlanLimitNotice,
} from '@/components/PageStates';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateWorkflowMutation,
  useDeleteWorkflowMutation,
  useListWorkflowsQuery,
} from '@/features/workflows/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { NODE_META } from '@/lib/nodeMeta';
import type { Workflow } from '@/lib/types';

function NewWorkflowDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [create, state] = useCreateWorkflowMutation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const workflow = await create({ name }).unwrap();
      void navigate(`/app/workflows/${workflow.id}`);
    } catch {
      // The error appears in the dialog.
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              required
              maxLength={100}
              placeholder="Triage new bug reports"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <PlanLimitNotice error={state.error} />
          {state.error && apiErrorCode(state.error) !== 'PLAN_LIMIT_REACHED' && (
            <Alert tone="error">{apiErrorMessage(state.error)}</Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={state.isLoading}>
              {state.isLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Create workflow
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A small strip of the workflow's steps in order, in their cable colors. */
function StepStrip({ workflow }: { workflow: Workflow }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {workflow.nodes.slice(0, 8).map((node) => (
        <span
          key={node.id}
          className="h-2 w-5 rounded-sm"
          style={{ backgroundColor: NODE_META[node.type].color }}
        />
      ))}
    </span>
  );
}

export default function Workflows() {
  const { data, isLoading, error, refetch } = useListWorkflowsQuery();
  const [remove] = useDeleteWorkflowMutation();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Workflow | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove(deleting.id).unwrap();
      toast.success(`${deleting.name} deleted`);
    } catch (failure) {
      toast.error(apiErrorMessage(failure));
    }
    setDeleting(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Workflows"
        description="Chain prompts, agents, tools and approvals into one repeatable job."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New workflow
          </Button>
        }
      />

      {isLoading && <ListSkeleton />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          action={<Button onClick={() => setCreating(true)}>New workflow</Button>}
        >
          Lay out steps on a board and wire them together. You can add a person’s approval anywhere.
        </EmptyState>
      )}

      <ul className="space-y-3">
        {data?.map((workflow) => (
          <li key={workflow.id} className="relative">
            <Link
              to={`/app/workflows/${workflow.id}`}
              className="panel block space-y-2 p-4 pr-14 transition-colors duration-150 hover:border-input"
            >
              <h2 className="truncate font-display text-lg font-semibold">{workflow.name}</h2>
              {workflow.description && (
                <p className="truncate text-sm text-muted-foreground">{workflow.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <StepStrip workflow={workflow} />
                <span>
                  {workflow.nodes.length} {workflow.nodes.length === 1 ? 'step' : 'steps'}, edited{' '}
                  {formatRelative(workflow.updatedAt)}
                </span>
                {!workflow.enabled && <span className="font-medium text-warning">Turned off</span>}
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4"
              aria-label={`Delete ${workflow.name}`}
              onClick={() => setDeleting(workflow)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      {creating && <NewWorkflowDialog open onClose={() => setCreating(false)} />}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Past runs stay in your history, and a run waiting for approval can still finish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep workflow</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
