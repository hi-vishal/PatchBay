import { ArrowUp, RotateCcw, Square } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Alert } from '@/components/Alert';
import { ErrorState, ListSkeleton } from '@/components/PageStates';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Message, ModelConfig } from '@/lib/types';
import { useListMessagesQuery } from './api';
import { Markdown } from './Markdown';
import { sendMessage, stopStreaming } from './sendMessage';
import type { TimelineStep } from './StepsTimeline';
import { CollapsibleSteps } from './StepsTimeline';

/** Trying again would give the same result, so these failures offer no retry. */
const NOT_RETRYABLE = new Set(['MODEL_REFUSED']);

function toolCallsToSteps(message: Message): TimelineStep[] {
  return message.toolCalls.map((call, index) => ({
    id: call.id ?? `${message.id}-${index}`,
    name: call.name,
    status: 'done',
    isError: call.isError,
    input: call.args,
    output: call.output,
  }));
}

function UserBubble({ children }: { children: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2 break-words whitespace-pre-wrap text-secondary-foreground">
        {children}
      </p>
    </div>
  );
}

const SavedMessage = memo(function SavedMessage({ message }: { message: Message }) {
  if (message.role === 'user') return <UserBubble>{message.content}</UserBubble>;
  return (
    <div className="space-y-2">
      <CollapsibleSteps steps={toolCallsToSteps(message)} />
      {message.content && <Markdown>{message.content}</Markdown>}
    </div>
  );
});

function LiveTurn() {
  const { pendingUserMessage, text, steps, status } = useAppSelector((state) => state.chat);
  const timeline = useMemo<TimelineStep[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        name: step.name,
        status: step.status,
        isError: step.isError,
        input: step.input,
        output: step.output,
      })),
    [steps],
  );
  const waiting = status === 'streaming' && !text && steps.every((step) => step.status === 'done');

  return (
    <div className="space-y-4">
      {pendingUserMessage && <UserBubble>{pendingUserMessage}</UserBubble>}
      <div className="space-y-2">
        <CollapsibleSteps steps={timeline} defaultOpen />
        {text && <Markdown highlight={false}>{text}</Markdown>}
        {waiting && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-signal" />
            Working on it
          </p>
        )}
      </div>
    </div>
  );
}

function RetryButton({ onRetry, disabled }: { onRetry: () => void; disabled: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onRetry}>
      <RotateCcw className="size-4" aria-hidden />
      Retry
    </Button>
  );
}

/** What the reader sees when a reply did not finish, and how to get it answered. */
function TurnNotice({ onRetry, disabled }: { onRetry: () => void; disabled: boolean }) {
  const { status, error } = useAppSelector((state) => state.chat);
  if (status === 'stopped') {
    return (
      <div role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        You stopped this reply.
        <RetryButton onRetry={onRetry} disabled={disabled} />
      </div>
    );
  }
  if (!error) return null;
  if (error.code === 'PLAN_LIMIT_REACHED') {
    return (
      <Alert tone="warning" title="You have used all your messages this month">
        <p>{error.message}</p>
        <Button asChild size="sm" className="mt-2">
          <Link to="/app/billing">See plans</Link>
        </Button>
      </Alert>
    );
  }
  return (
    <Alert tone="error" title="This reply did not finish">
      <p>{error.message}</p>
      {!NOT_RETRYABLE.has(error.code) && (
        <div className="mt-2">
          <RetryButton onRetry={onRetry} disabled={disabled} />
        </div>
      )}
    </Alert>
  );
}

export interface ChatThreadProps {
  conversationId: string | null;
  agentId: string | null;
  model?: ModelConfig;
  placeholder?: string;
  /** Shown when the conversation has no messages yet. */
  empty?: ReactNode;
  /** Controls above the composer, such as the agent and model pickers. */
  toolbar?: ReactNode;
  disabled?: boolean;
  /** Called once the server has named the conversation this thread started. */
  onConversationCreated?: (conversationId: string) => void;
}

/** Messages, the live reply, and the composer. Used by the chat page and the agent test panel. */
export function ChatThread({
  conversationId,
  agentId,
  model,
  placeholder = 'Ask anything',
  empty,
  toolbar,
  disabled = false,
  onConversationCreated,
}: ChatThreadProps) {
  const dispatch = useAppDispatch();
  const chat = useAppSelector((state) => state.chat);
  const [draft, setDraft] = useState('');

  // `currentData`, not `data`: `data` keeps the last chat's messages when moving to another chat.
  const {
    currentData: data,
    isFetching,
    error,
    refetch,
  } = useListMessagesQuery(conversationId ?? '', {
    skip: !conversationId,
  });
  const isLoading = isFetching && !data;

  const streaming = chat.status === 'streaming';
  // A stream belongs here if it was assigned this conversation. Before it has one, it belongs to
  // the new chat for the same agent, which keeps the test panel and chat page apart.
  const showsLive =
    chat.status !== 'idle' &&
    chat.conversationId === conversationId &&
    (conversationId !== null || chat.agentId === agentId);

  const messages = useMemo(() => {
    const saved = data ?? [];
    if (!showsLive || !chat.pendingUserMessage) return saved;
    // The server saves the user message first, so a refetch mid-stream could show it twice.
    const last = saved.at(-1);
    return last?.role === 'user' && last.content === chat.pendingUserMessage
      ? saved.slice(0, -1)
      : saved;
  }, [data, showsLive, chat.pendingUserMessage]);

  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }, []);

  // Follows new content, unless the reader has scrolled up to read something earlier.
  useEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages, chat.text, chat.steps, chat.pendingUserMessage]);

  const start = (message: string, retry?: boolean) => {
    stickToBottom.current = true;
    void dispatch(
      sendMessage({
        message,
        conversationId,
        agentId,
        model,
        retry,
        onConversation: onConversationCreated,
      }),
    );
  };

  const send = () => {
    const message = draft.trim();
    if (!message || streaming || disabled) return;
    setDraft('');
    start(message);
  };

  const retry = () => {
    if (chat.lastMessage && !streaming && !disabled) start(chat.lastMessage, true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const isEmpty = !isLoading && messages.length === 0 && !showsLive && !error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-busy={streaming}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
          {isLoading && !showsLive && <ListSkeleton rows={2} />}
          {error && <ErrorState error={error} onRetry={() => void refetch()} />}
          {isEmpty && empty}
          {messages.map((message) => (
            <SavedMessage key={message.id} message={message} />
          ))}
          {showsLive && <LiveTurn />}
          {showsLive && <TurnNotice onRetry={retry} disabled={disabled} />}
        </div>
      </div>

      <div className="border-t bg-background">
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-3">
          {toolbar}
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label="Message"
              rows={1}
              disabled={disabled}
              className="max-h-48 min-h-11 resize-none text-base [field-sizing:content]"
            />
            {streaming ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Stop"
                onClick={stopStreaming}
              >
                <Square className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Send"
                disabled={!draft.trim() || disabled}
                onClick={send}
              >
                <ArrowUp className="size-5" aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
