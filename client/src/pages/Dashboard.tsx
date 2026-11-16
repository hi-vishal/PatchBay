import {
  Bot,
  Circle,
  CircleCheck,
  MessageSquare,
  Plus,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  PageContainer,
  PageHeader,
} from '@/components/PageStates';
import { Meter } from '@/components/Meter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetProvidersQuery, useListAgentsQuery } from '@/features/agents/api';
import { useListConversationsQuery } from '@/features/chat/api';
import { RunStatusBadge } from '@/features/workflows/RunStatusBadge';
import { useListRunsQuery } from '@/features/workflows/api';
import { useGetMeQuery } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

function UsageTile({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  return (
    <div className="panel space-y-4 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-display text-3xl leading-none font-semibold tabular-nums">
        {used.toLocaleString('en-IN')}
        <span className="ml-2 font-sans text-base font-normal tracking-normal text-muted-foreground">
          {limit === null ? 'with no limit' : `of ${limit.toLocaleString('en-IN')}`}
        </span>
      </p>
      {limit !== null && <Meter value={used} max={limit} label={`${label}: ${used} of ${limit}`} />}
    </div>
  );
}

/** A short checklist for a new account. It goes away once every step is done. */
function GetStarted() {
  const providers = useGetProvidersQuery();
  const chats = useListConversationsQuery();
  const agents = useListAgentsQuery();
  const runs = useListRunsQuery({ limit: 5 });
  if (!providers.data || !chats.data || !agents.data || !runs.data) return null;

  const steps = [
    {
      done: providers.data.items.some((provider) => provider.configured),
      title: 'Connect a model',
      body: 'Add a key, pick a free model, or use Ollama on your machine.',
      to: '/app/settings',
      action: 'Open settings',
    },
    {
      done: chats.data.length > 0,
      title: 'Ask your first question',
      body: 'Chat with a model and watch the reply arrive.',
      to: '/app/chat',
      action: 'Open chat',
    },
    {
      done: agents.data.length > 0,
      title: 'Give an agent a job',
      body: 'Write its instructions and switch on the tools it may use.',
      to: '/app/agents/new',
      action: 'New agent',
    },
    {
      done: runs.data.length > 0,
      title: 'Run a workflow',
      body: 'Chain steps on a board and add an approval where it matters.',
      to: '/app/workflows',
      action: 'Open workflows',
    },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (remaining === 0) return null;

  return (
    <section aria-label="Get set up" className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="font-display text-lg font-semibold">Get set up</h2>
        <p className="text-sm text-muted-foreground">
          {steps.length - remaining} of {steps.length} done
        </p>
      </div>
      <ol className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {steps.map((step) => (
          <li key={step.title} className="flex flex-col gap-2 p-5">
            <p className="flex items-center gap-2.5 font-medium">
              {step.done ? (
                <CircleCheck className="size-4 shrink-0 text-success" aria-label="Done" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="To do" />
              )}
              <span className={cn(step.done && 'text-muted-foreground line-through')}>
                {step.title}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{step.body}</p>
            {!step.done && (
              <Link
                to={step.to}
                className="mt-auto w-fit pt-1 text-sm font-medium text-link underline-offset-4 hover:underline"
              >
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Usage() {
  const { data, isLoading, error, refetch } = useGetMeQuery();
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-[8.5rem] rounded-xl" />
        ))}
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const { usage, limits } = data;
  return (
    <section aria-label="Usage this month" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UsageTile
        label="Messages this month"
        used={usage.messages}
        limit={limits.messagesPerMonth}
      />
      <UsageTile label="Workflow runs this month" used={usage.runs} limit={limits.runsPerMonth} />
      <UsageTile label="Agents" used={usage.agents} limit={limits.agents} />
      <UsageTile label="MCP servers" used={usage.mcpServers} limit={limits.mcpServers} />
    </section>
  );
}

function PanelHeading({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <Link to={to} className="text-sm text-link underline-offset-4 hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}

const ROW =
  'flex min-h-14 items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-edge transition-colors duration-150 hover:border-input';

function RecentChats() {
  const { data, isLoading, error, refetch } = useListConversationsQuery();
  return (
    <section className="space-y-3">
      <PanelHeading title="Recent chats" to="/app/chat" linkLabel="All chats" />
      {isLoading && <ListSkeleton />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={MessageSquare}
          title="No chats yet"
          action={
            <Button asChild>
              <Link to="/app/chat">Start a chat</Link>
            </Button>
          }
        >
          Ask anything. Your conversations are saved here.
        </EmptyState>
      )}
      <ul className="space-y-2">
        {data?.slice(0, 5).map((conversation) => (
          <li key={conversation.id}>
            <Link to={`/app/chat/${conversation.id}`} className={ROW}>
              <span className="truncate font-medium">{conversation.title}</span>
              <span className="shrink-0 text-sm text-muted-foreground">
                {formatRelative(conversation.updatedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function YourAgents() {
  const { data, isLoading, error, refetch } = useListAgentsQuery();
  return (
    <section className="space-y-3">
      <PanelHeading title="Your agents" to="/app/agents" linkLabel="All agents" />
      {isLoading && <ListSkeleton />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          action={
            <Button asChild>
              <Link to="/app/agents/new">Build an agent</Link>
            </Button>
          }
        >
          An agent has its own instructions, model and tools.
        </EmptyState>
      )}
      <ul className="space-y-2">
        {data?.slice(0, 5).map((agent) => (
          <li key={agent.id}>
            <Link to={`/app/agents/${agent.id}`} className={ROW}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{agent.name}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {agent.description || agent.model.name}
                </span>
              </span>
              <Badge variant="secondary" className="shrink-0">
                {agent.tools.length + agent.mcpServerIds.length} tools
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentRuns() {
  const { data, isLoading, error, refetch } = useListRunsQuery({ limit: 5 });
  return (
    <section className="space-y-3">
      <PanelHeading title="Recent runs" to="/app/workflows" linkLabel="All workflows" />
      {isLoading && <ListSkeleton rows={2} />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data?.length === 0 && (
        <EmptyState
          icon={WorkflowIcon}
          title="Nothing has run yet"
          action={
            <Button asChild variant="outline">
              <Link to="/app/workflows">Open workflows</Link>
            </Button>
          }
        >
          Workflow runs and agent runs appear here, with every step they took.
        </EmptyState>
      )}
      <ul className="space-y-2">
        {data?.map((run) => (
          <li key={run.id} className={cn(ROW, 'hover:border-border')}>
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {typeof run.input === 'string' && run.input ? run.input : 'Run with no input'}
              </span>
              <span className="block text-sm text-muted-foreground">
                {run.steps.length} {run.steps.length === 1 ? 'step' : 'steps'},{' '}
                {formatRelative(run.createdAt)}
              </span>
            </span>
            <RunStatusBadge status={run.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const user = useAppSelector((state) => state.auth.user);
  const firstName = user?.name.split(' ')[0];

  return (
    <PageContainer>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : 'Hello'}
        description="Your usage, recent work and agents."
        actions={
          <Button asChild>
            <Link to="/app/chat">
              <Plus className="size-4" aria-hidden />
              New chat
            </Link>
          </Button>
        }
      />
      <GetStarted />
      <Usage />
      <div className="grid gap-8 lg:grid-cols-2">
        <RecentChats />
        <YourAgents />
      </div>
      <RecentRuns />
    </PageContainer>
  );
}
