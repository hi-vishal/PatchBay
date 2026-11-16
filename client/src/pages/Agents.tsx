import { Bot, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageContainer,
  PageHeader,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteAgentMutation, useListAgentsQuery } from '@/features/agents/api';
import { apiErrorMessage } from '@/lib/api';
import { BUILTIN_TOOLS } from '@/lib/nodeMeta';
import type { Agent } from '@/lib/types';

function AgentCard({ agent, onDelete }: { agent: Agent; onDelete: () => void }) {
  return (
    <article className="panel flex flex-col gap-4 p-5 sm:p-6">
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="truncate font-display text-xl font-semibold">{agent.name}</h2>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {agent.description || 'No description yet.'}
        </p>
      </div>

      <ul aria-label="What this agent can use" className="flex flex-wrap gap-1.5">
        <li>
          <Badge variant="outline" className="font-mono">
            {agent.model.name}
          </Badge>
        </li>
        {agent.tools.map((tool) => (
          <li key={tool}>
            <Badge variant="secondary">
              {BUILTIN_TOOLS.find((item) => item.id === tool)?.name ?? tool}
            </Badge>
          </li>
        ))}
        {agent.mcpServerIds.length > 0 && (
          <li>
            <Badge variant="secondary">
              {agent.mcpServerIds.length} MCP{' '}
              {agent.mcpServerIds.length === 1 ? 'server' : 'servers'}
            </Badge>
          </li>
        )}
      </ul>

      <div className="flex items-center gap-2">
        <Button asChild size="sm">
          <Link to={`/app/chat?agent=${agent.id}`}>
            <MessageSquare className="size-4" aria-hidden />
            Chat
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`/app/agents/${agent.id}`}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </Link>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          className="ml-auto"
          aria-label={`Delete ${agent.name}`}
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </article>
  );
}

export default function Agents() {
  const { data, isLoading, error, refetch } = useListAgentsQuery();
  const [remove] = useDeleteAgentMutation();
  const [deleting, setDeleting] = useState<Agent | null>(null);

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleting(null);
    try {
      await remove(deleting.id).unwrap();
      toast.success(`${deleting.name} deleted`);
    } catch (failure) {
      toast.error(`Could not delete ${deleting.name}. ${apiErrorMessage(failure)}`);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Agents"
        description="Each agent has its own instructions, model and tools."
        actions={
          <Button asChild>
            <Link to="/app/agents/new">
              <Plus className="size-4" aria-hidden />
              New agent
            </Link>
          </Button>
        }
      />

      {isLoading && <ListSkeleton rows={3} className="[&>*]:h-44" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={Bot}
          title="Build your first agent"
          action={
            <Button asChild>
              <Link to="/app/agents/new">New agent</Link>
            </Button>
          }
        >
          Write its instructions, pick a model, and choose which tools it can use.
        </EmptyState>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onDelete={() => setDeleting(agent)} />
        ))}
      </div>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its past chats stay in your history, and continue as plain chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep agent</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Delete agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
