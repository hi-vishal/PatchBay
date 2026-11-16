import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Alert } from '@/components/Alert';
import { ErrorState, ListSkeleton, PlanLimitNotice } from '@/components/PageStates';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateAgentMutation,
  useGetAgentQuery,
  useGetProvidersQuery,
  useUpdateAgentMutation,
} from '@/features/agents/api';
import { ModelPicker } from '@/features/agents/ModelPicker';
import { ChatThread } from '@/features/chat/ChatThread';
import { streamCleared } from '@/features/chat/chatSlice';
import { useListMcpServersQuery } from '@/features/mcp/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { BUILTIN_TOOLS } from '@/lib/nodeMeta';
import type { Agent, AgentInput, BuiltinTool } from '@/lib/types';

const FALLBACK_MODEL = {
  provider: 'anthropic',
  name: 'claude-opus-5-5',
  temperature: 0.7,
} as const;

function toFormValues(agent?: Agent): AgentInput {
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    systemPrompt: agent?.systemPrompt ?? '',
    model: agent?.model ?? FALLBACK_MODEL,
    tools: agent?.tools ?? [],
    mcpServerIds: agent?.mcpServerIds ?? [],
    memoryEnabled: agent?.memoryEnabled ?? true,
  };
}

function toggled<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...list, item] : list.filter((value) => value !== item);
}

const FIELDSET = 'panel space-y-4 p-5 sm:p-6';
const LEGEND = 'font-display text-lg font-semibold';

function ToolChoice({
  id,
  name,
  description,
  checked,
  onChange,
}: {
  id: string;
  name: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md p-2 transition-colors duration-150 hover:bg-muted">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="block cursor-pointer space-y-0.5 font-normal">
        <span className="block font-medium">{name}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </Label>
    </div>
  );
}

function AgentForm({
  agent,
  onDirtyChange,
}: {
  agent?: Agent;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<AgentInput>(() => toFormValues(agent));
  const { data: providers } = useGetProvidersQuery();
  const {
    data: servers,
    isLoading: serversLoading,
    error: serversError,
    refetch: refetchServers,
  } = useListMcpServersQuery();
  const [create, createState] = useCreateAgentMutation();
  const [update, updateState] = useUpdateAgentMutation();
  const saving = createState.isLoading || updateState.isLoading;
  const failure = createState.error ?? updateState.error;

  // A new agent starts on whichever provider this deployment has configured.
  useEffect(() => {
    if (agent || !providers) return;
    const usable = providers.items.some(
      (item) => item.provider === providers.default.provider && item.configured,
    )
      ? providers.default
      : providers.items
          .filter((item) => item.configured)
          .map((item) => ({ provider: item.provider, name: item.models[0] ?? '' }))[0];
    if (usable) setValues((current) => ({ ...current, model: { ...current.model, ...usable } }));
  }, [agent, providers]);

  const saved = useMemo(() => toFormValues(agent), [agent]);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const set = <K extends keyof AgentInput>(key: K, value: AgentInput[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (agent) {
        await update({ id: agent.id, changes: values }).unwrap();
        toast.success('Agent saved');
      } else {
        const created = await create(values).unwrap();
        toast.success('Agent created');
        void navigate(`/app/agents/${created.id}`, { replace: true });
      }
    } catch {
      // The error appears next to the save button.
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <section className={FIELDSET}>
        <div className="space-y-2">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            required
            maxLength={100}
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-description">Description</Label>
          <Input
            id="agent-description"
            maxLength={500}
            value={values.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="agent-prompt">Instructions</Label>
          <Textarea
            id="agent-prompt"
            rows={7}
            maxLength={20_000}
            value={values.systemPrompt}
            onChange={(event) => set('systemPrompt', event.target.value)}
            placeholder="Describe what this agent does and how it should behave."
          />
        </div>
      </section>

      <section className={FIELDSET}>
        <h2 className={LEGEND}>Model</h2>
        <ModelPicker value={values.model} onChange={(model) => set('model', model)} />
      </section>

      <section className={FIELDSET}>
        <h2 className={LEGEND}>Tools</h2>
        <div className="grid gap-1 sm:grid-cols-2">
          {BUILTIN_TOOLS.map((tool) => (
            <ToolChoice
              key={tool.id}
              id={`tool-${tool.id}`}
              name={tool.name}
              description={tool.description}
              checked={values.tools?.includes(tool.id) ?? false}
              onChange={(on) => set('tools', toggled<BuiltinTool>(values.tools ?? [], tool.id, on))}
            />
          ))}
        </div>
      </section>

      <section className={FIELDSET}>
        <h2 className={LEGEND}>MCP servers</h2>
        {serversLoading && <ListSkeleton rows={2} className="[&>*]:h-12" />}
        {serversError && <ErrorState error={serversError} onRetry={() => void refetchServers()} />}
        {servers?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No servers connected yet.{' '}
            <Link to="/app/mcp" className="text-link underline-offset-4 hover:underline">
              Connect one
            </Link>{' '}
            to give this agent its tools.
          </p>
        )}
        <div className="grid gap-1 sm:grid-cols-2">
          {servers?.map((server) => (
            <ToolChoice
              key={server.id}
              id={`server-${server.id}`}
              name={server.name}
              description={server.enabled ? (server.url ?? server.command ?? '') : 'Turned off'}
              checked={values.mcpServerIds?.includes(server.id) ?? false}
              onChange={(on) =>
                set('mcpServerIds', toggled(values.mcpServerIds ?? [], server.id, on))
              }
            />
          ))}
        </div>
      </section>

      <section className={FIELDSET}>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="agent-memory" className="block space-y-0.5 font-normal">
            <span className="block font-medium">Remember earlier messages</span>
            <span className="block text-sm text-muted-foreground">
              Turned off, each message is handled on its own.
            </span>
          </Label>
          <Switch
            id="agent-memory"
            checked={values.memoryEnabled}
            onCheckedChange={(on) => set('memoryEnabled', on)}
          />
        </div>
      </section>

      <PlanLimitNotice error={failure} />
      {failure && apiErrorCode(failure) !== 'PLAN_LIMIT_REACHED' && (
        <Alert tone="error">{apiErrorMessage(failure)}</Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || (Boolean(agent) && !dirty)}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {agent ? 'Save changes' : 'Create agent'}
        </Button>
        {agent && dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
      </div>
    </form>
  );
}

function TestPanel({ agent, unsaved }: { agent?: Agent; unsaved: boolean }) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.chat.status);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const startOver = () => {
    setConversationId(null);
    dispatch(streamCleared());
  };

  return (
    <section
      aria-label="Test this agent"
      className="flex h-[32rem] flex-col overflow-hidden panel lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]"
    >
      <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="font-display text-lg font-semibold">Test agent</h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={status === 'streaming' || (!conversationId && status === 'idle')}
          onClick={startOver}
        >
          <RotateCcw className="size-4" aria-hidden />
          New test
        </Button>
      </header>
      {agent && unsaved && (
        <p role="status" className="border-b bg-warning/10 px-4 py-2 text-sm">
          This chat uses the last saved version. Save your changes to test them.
        </p>
      )}
      <div className="min-h-0 flex-1">
        {agent ? (
          <ChatThread
            conversationId={conversationId}
            agentId={agent.id}
            placeholder={`Message ${agent.name}`}
            onConversationCreated={setConversationId}
            empty={
              <p className="py-8 text-muted-foreground">
                Try it out here. Tools run for real, and each message counts toward your plan.
              </p>
            }
          />
        ) : (
          <p className="p-5 text-muted-foreground">Create the agent, then test it right here.</p>
        )}
      </div>
    </section>
  );
}

export default function AgentBuilder() {
  const { agentId } = useParams();
  const {
    data: agent,
    isLoading,
    error,
    refetch,
  } = useGetAgentQuery(agentId ?? '', {
    skip: !agentId,
  });
  const [unsaved, setUnsaved] = useState(false);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-8">
      <header className="space-y-2">
        <Link
          to="/app/agents"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Agents
        </Link>
        <h1 className="font-display text-3xl leading-tight font-semibold">
          {agentId ? (agent?.name ?? 'Agent') : 'New agent'}
        </h1>
      </header>

      {isLoading && <ListSkeleton rows={4} className="[&>*]:h-40" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {(!agentId || agent) && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {/* The key restarts the form when the route moves from new to the saved agent. */}
          <AgentForm key={agent?.id ?? 'new'} agent={agent} onDirtyChange={setUnsaved} />
          <TestPanel key={agent?.id ?? 'new-test'} agent={agent} unsaved={unsaved} />
        </div>
      )}
    </div>
  );
}
