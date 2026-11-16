import type { AppDispatch } from '@/app/store';
import { API_BASE, api } from '@/lib/api';
import type { SseEvent } from '@/lib/sse';
import { StreamRequestError, streamSse } from '@/lib/sse';
import type { ModelConfig } from '@/lib/types';
import { chatApi } from './api';
import {
  conversationAssigned,
  liveCopySaved,
  streamCleared,
  streamFailed,
  streamStarted,
  streamStopped,
  tokensReceived,
  toolFinished,
  toolStarted,
} from './chatSlice';

/** Tokens arrive faster than the eye. Batching them avoids re-rendering for every word. */
const TOKEN_FLUSH_MS = 40;
/** How long to give the server to save a stopped reply before reading the messages again. */
const STOP_SAVE_WAIT_MS = 400;
const CONNECTION_DROPPED = {
  code: 'NETWORK',
  message: 'The connection dropped. Check it and try again.',
};

let activeStream: AbortController | null = null;

export function stopStreaming(): void {
  activeStream?.abort();
}

export interface SendOptions {
  message: string;
  conversationId: string | null;
  agentId: string | null;
  model?: ModelConfig;
  /** Answers the last message again, in place of a reply that did not finish. */
  retry?: boolean;
  /** Called once the server has named the conversation. */
  onConversation?: (conversationId: string) => void;
}

export function sendMessage({
  message,
  conversationId,
  agentId,
  model,
  retry,
  onConversation,
}: SendOptions) {
  return async (dispatch: AppDispatch): Promise<void> => {
    const controller = new AbortController();
    activeStream = controller;

    // The server drops the unfinished reply on a retry, so drop it from view first.
    if (retry && conversationId) {
      dispatch(
        chatApi.util.updateQueryData('listMessages', conversationId, (saved) => {
          const lastUser = saved.findLastIndex((item) => item.role === 'user');
          if (saved[lastUser]?.content === message) saved.splice(lastUser + 1);
        }),
      );
    }
    dispatch(streamStarted({ message, conversationId, agentId }));

    let resolvedId = conversationId;
    let opened = false;
    let produced = false;
    let finished = false;
    let pendingTokens = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failed = false;

    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pendingTokens) dispatch(tokensReceived(pendingTokens));
      pendingTokens = '';
    };

    const fail = (error: { code: string; message: string }) => {
      failed = true;
      flush();
      dispatch(streamFailed(error));
    };

    const onEvent = ({ event, data }: SseEvent) => {
      switch (event) {
        case 'token':
          produced = true;
          pendingTokens += (data as { text: string }).text;
          timer ??= setTimeout(flush, TOKEN_FLUSH_MS);
          break;
        case 'tool_start':
          produced = true;
          flush();
          dispatch(toolStarted(data as Parameters<typeof toolStarted>[0]));
          break;
        case 'tool_end':
          flush();
          dispatch(toolFinished(data as Parameters<typeof toolFinished>[0]));
          break;
        case 'error':
          fail(data as { code: string; message: string });
          break;
        case 'done':
          finished = true;
          flush();
          break;
      }
    };

    try {
      await streamSse({
        url: agentId ? `${API_BASE}/agents/${agentId}/chat` : `${API_BASE}/chat`,
        body: {
          message,
          ...(conversationId ? { conversationId } : {}),
          ...(!agentId && model ? { model } : {}),
          ...(retry ? { retry } : {}),
        },
        signal: controller.signal,
        onResponse: (response) => {
          opened = true;
          const id = response.headers.get('X-Conversation-Id');
          if (id) {
            resolvedId = id;
            dispatch(conversationAssigned(id));
            onConversation?.(id);
            // A new chat should appear in the list right away, not when the reply ends.
            if (!conversationId) dispatch(api.util.invalidateTags(['Conversation']));
          }
        },
        onEvent,
      });
      // A stream that ends with neither event was cut off, by a proxy or a server restart.
      if (!finished && !failed && !controller.signal.aborted) fail(CONNECTION_DROPPED);
    } catch (error) {
      if (!controller.signal.aborted) {
        fail(
          error instanceof StreamRequestError
            ? { code: error.code, message: error.message }
            : CONNECTION_DROPPED,
        );
      }
    } finally {
      flush();
      if (activeStream === controller) activeStream = null;
    }

    const stopped = controller.signal.aborted;
    if (stopped) dispatch(streamStopped());

    dispatch(api.util.invalidateTags(['Conversation', 'Me', 'Run']));

    // Swap the live copy for the saved messages in one step, so nothing flickers. A turn that did
    // not finish keeps its notice on screen until the next message.
    if (resolvedId) {
      const id = resolvedId;
      const readSaved = () =>
        dispatch(
          chatApi.endpoints.listMessages.initiate(id, { subscribe: false, forceRefetch: true }),
        );
      const endsWithReply = (read: Awaited<ReturnType<typeof readSaved>>) =>
        read.isSuccess && read.data.at(-1)?.role === 'assistant';

      let saved = await readSaved();
      // The server saves a stopped reply once it notices the disconnect, which can be after that read.
      if (stopped && opened && produced && !endsWithReply(saved)) {
        await new Promise((resolve) => setTimeout(resolve, STOP_SAVE_WAIT_MS));
        saved = await readSaved();
      }

      // The reader can send again as soon as a turn stops, and that newer turn owns the state now.
      if (activeStream) return;
      if ((stopped || failed) && opened && endsWithReply(saved)) dispatch(liveCopySaved());
    }
    if (!failed && !stopped) dispatch(streamCleared());
  };
}
