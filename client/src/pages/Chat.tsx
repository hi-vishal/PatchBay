import { Bot, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Alert } from '@/components/Alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useGetProvidersQuery, useListAgentsQuery } from '@/features/agents/api';
import { useListConversationsQuery } from '@/features/chat/api';
import { ChatThread } from '@/features/chat/ChatThread';
import { streamCleared } from '@/features/chat/chatSlice';
import { ConversationList } from '@/features/chat/ConversationList';
import { PROVIDER_NAMES, modelLabel } from '@/features/llm/providers';
import { chatModelChosen } from '@/features/ui/uiSlice';
import type { LlmProvider, ModelConfig } from '@/lib/types';

const NO_AGENT = 'none';

function modelValue(model: ModelConfig): string {
  return `${model.provider}:${model.name}`;
}

function parseModelValue(value: string): ModelConfig {
  const separator = value.indexOf(':');
  return {
    provider: value.slice(0, separator) as LlmProvider,
    name: value.slice(separator + 1),
  };
}

export default function Chat() {
  const { conversationId = null } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const chat = useAppSelector((state) => state.chat);
  const { data: agents, isLoading: agentsLoading, isError: agentsFailed } = useListAgentsQuery();
  const { data: conversations } = useListConversationsQuery();
  const { data: providers } = useGetProvidersQuery();
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const conversation = conversations?.find((item) => item.id === conversationId);
  // An old link can name an agent that has since been deleted.
  const requestedAgent = params.get('agent');
  const selectedAgent =
    requestedAgent && (!agents || agents.some((item) => item.id === requestedAgent))
      ? requestedAgent
      : NO_AGENT;

  // An existing chat keeps the agent it started with. A new one uses the picker.
  const streamedAgent = chat.conversationId === conversationId ? chat.agentId : null;
  const agentId = conversationId
    ? (conversation?.agentId ?? streamedAgent)
    : selectedAgent === NO_AGENT
      ? null
      : selectedAgent;
  const agent = agents?.find((item) => item.id === agentId);

  const configured = useMemo(
    () => providers?.items.filter((provider) => provider.configured) ?? [],
    [providers],
  );

  const defaultModel = useMemo<ModelConfig | undefined>(() => {
    if (!providers) return undefined;
    const fallback = configured[0];
    if (configured.some((item) => item.provider === providers.default.provider)) {
      return providers.default;
    }
    return fallback ? { provider: fallback.provider, name: fallback.models[0] ?? '' } : undefined;
  }, [providers, configured]);

  // A choice from earlier stops applying if its provider has since been removed.
  const chosenModel = useAppSelector((state) => state.ui.chatModel);
  const model =
    chosenModel && configured.some((item) => item.provider === chosenModel.provider)
      ? chosenModel
      : defaultModel;
  const noProviders = Boolean(providers) && configured.length === 0;

  // Once a new chat has an id, move to its address so it can be reloaded and shared with tabs. Only
  // once, so that "New chat" can still leave it.
  const followedChat = useRef<string | null>(null);
  useEffect(() => {
    if (
      !conversationId &&
      chat.startedNewChat &&
      chat.status !== 'idle' &&
      chat.conversationId &&
      followedChat.current !== chat.conversationId
    ) {
      followedChat.current = chat.conversationId;
      void navigate(`/app/chat/${chat.conversationId}`, { replace: true });
    }
  }, [conversationId, chat.startedNewChat, chat.status, chat.conversationId, navigate]);

  // A turn that did not finish keeps its notice until the reader moves to another chat.
  const previousRoute = useRef(conversationId);
  useEffect(() => {
    const moved = previousRoute.current !== conversationId;
    previousRoute.current = conversationId;
    const settled = chat.status === 'error' || chat.status === 'stopped';
    if (moved && settled && chat.conversationId !== conversationId) dispatch(streamCleared());
  }, [chat.status, chat.conversationId, conversationId, dispatch]);

  // Each message names its model, so a saved chat can move to another model at any point.
  const modelSelect =
    !agentId && model && (!conversationId || conversations) ? (
      <Select
        value={modelValue(model)}
        onValueChange={(value) => dispatch(chatModelChosen(parseModelValue(value)))}
      >
        <SelectTrigger size="sm" aria-label="Model" className="max-w-72 min-w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {configured.map((provider) => (
            <SelectGroup key={provider.provider}>
              <SelectLabel>
                {PROVIDER_NAMES[provider.provider]}
                {provider.freeOnly ? ' (free)' : ''}
              </SelectLabel>
              {[
                ...new Set([
                  ...provider.models,
                  ...(model.provider === provider.provider ? [model.name] : []),
                ]),
              ].map((name) => (
                <SelectItem key={name} value={`${provider.provider}:${name}`}>
                  {modelLabel(provider, name)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  const toolbar =
    !conversationId || modelSelect ? (
      <div className="flex flex-wrap gap-2">
        {!conversationId && (
          <Select
            value={selectedAgent}
            disabled={agentsLoading}
            onValueChange={(value) =>
              setParams(value === NO_AGENT ? {} : { agent: value }, { replace: true })
            }
          >
            <SelectTrigger size="sm" aria-label="Agent" className="min-w-40">
              <SelectValue placeholder="Loading agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_AGENT}>No agent</SelectItem>
              {agents?.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
              {agentsFailed && (
                <SelectItem value="unavailable" disabled>
                  Could not load your agents
                </SelectItem>
              )}
              {agents?.length === 0 && (
                <SelectItem value="none-yet" disabled>
                  You have no agents yet
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
        {modelSelect}
      </div>
    ) : null;

  return (
    <div className="flex h-full min-h-0">
      <aside aria-label="Chats" className="hidden w-72 shrink-0 border-r bg-background/40 md:block">
        <ConversationList />
      </aside>

      <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <ConversationList onNavigate={() => setMobileListOpen(false)} />
        </SheetContent>
      </Sheet>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-13 items-center gap-2 border-b px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:hidden"
            aria-label="Open chat list"
            onClick={() => setMobileListOpen(true)}
          >
            <MessagesSquare className="size-5" aria-hidden />
          </Button>
          <h1 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
            {conversation?.title ?? 'New chat'}
          </h1>
          {agent && (
            <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
              <Bot className="size-4 text-node-agent" aria-hidden />
              {agent.name}
            </span>
          )}
        </header>

        <div className="min-h-0 flex-1">
          <ChatThread
            conversationId={conversationId}
            agentId={agentId}
            model={model}
            toolbar={toolbar}
            // Until the list loads, a deep link cannot tell which agent owns this chat.
            disabled={(noProviders && !agentId) || (Boolean(conversationId) && !conversations)}
            placeholder={agent ? `Message ${agent.name}` : 'Ask anything'}
            empty={
              noProviders ? (
                <Alert tone="warning" title="No AI provider is set up">
                  Add an API key in{' '}
                  <Link to="/app/settings" className="font-medium underline">
                    Settings
                  </Link>
                  . OpenRouter has free models, and{' '}
                  <Link to="/app/settings/ollama" className="font-medium underline">
                    Ollama
                  </Link>{' '}
                  runs models on your own computer.
                </Alert>
              ) : (
                <div className="space-y-2 py-12">
                  <h2 className="font-display text-3xl leading-tight font-semibold">
                    {agent ? `Chat with ${agent.name}` : 'What do you want to get done?'}
                  </h2>
                  <p className="max-w-md text-muted-foreground">
                    {agent
                      ? 'Every tool it uses appears as a step, with its input and output.'
                      : 'Ask a question here, or pick an agent below to use its tools.'}
                  </p>
                </div>
              )
            }
          />
        </div>
      </section>
    </div>
  );
}
