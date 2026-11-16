import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

export interface StreamStep {
  /** Tool call id when the server provides one, otherwise a local sequence id. */
  id: string;
  name: string;
  input: unknown;
  output?: string;
  isError: boolean;
  status: 'running' | 'done';
}

export type StreamStatus = 'idle' | 'streaming' | 'stopped' | 'error';

interface ChatState {
  status: StreamStatus;
  /** The conversation being streamed. Null until the server names a new chat. */
  conversationId: string | null;
  agentId: string | null;
  /** True when this stream began a new chat, so the chat page moves to that chat's address. */
  startedNewChat: boolean;
  pendingUserMessage: string | null;
  /** What a retry sends. It outlasts the live copy, which goes once the saved messages load. */
  lastMessage: string | null;
  text: string;
  steps: StreamStep[];
  error: { code: string; message: string } | null;
}

const initialState: ChatState = {
  status: 'idle',
  conversationId: null,
  agentId: null,
  startedNewChat: false,
  pendingUserMessage: null,
  lastMessage: null,
  text: '',
  steps: [],
  error: null,
};

/** A step still running when the turn ended never finished, so it must not look successful. */
function endRunningSteps(steps: StreamStep[]): void {
  for (const step of steps) {
    if (step.status === 'running') {
      step.status = 'done';
      step.isError = true;
    }
  }
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    streamStarted(
      _state,
      action: PayloadAction<{
        message: string;
        conversationId: string | null;
        agentId: string | null;
      }>,
    ) {
      const { message, conversationId, agentId } = action.payload;
      return {
        ...initialState,
        status: 'streaming',
        pendingUserMessage: message,
        lastMessage: message,
        conversationId,
        agentId,
        startedNewChat: conversationId === null,
      };
    },
    conversationAssigned(state, action: PayloadAction<string>) {
      state.conversationId = action.payload;
    },
    tokensReceived(state, action: PayloadAction<string>) {
      state.text += action.payload;
    },
    toolStarted(state, action: PayloadAction<{ id?: string; name: string; input: unknown }>) {
      const { id, name, input } = action.payload;
      state.steps.push({
        id: id ?? `${name}-${state.steps.length}`,
        name,
        input,
        isError: false,
        status: 'running',
      });
    },
    toolFinished(
      state,
      action: PayloadAction<{ id?: string; name: string; output: string; isError: boolean }>,
    ) {
      const { id, name, output, isError } = action.payload;
      const step = state.steps.findLast((item) =>
        id ? item.id === id : item.name === name && item.status === 'running',
      );
      if (step) {
        step.output = output;
        step.isError = isError;
        step.status = 'done';
      }
    },
    streamFailed(state, action: PayloadAction<{ code: string; message: string }>) {
      state.status = 'error';
      state.error = action.payload;
      endRunningSteps(state.steps);
    },
    streamStopped(state) {
      state.status = 'stopped';
      endRunningSteps(state.steps);
    },
    /** The saved messages now include this turn, so showing the live copy would repeat it. */
    liveCopySaved(state) {
      state.pendingUserMessage = null;
      state.text = '';
      state.steps = [];
    },
    /** The saved messages have loaded, so the live copy can go. */
    streamCleared() {
      return initialState;
    },
  },
});

export const {
  streamStarted,
  conversationAssigned,
  tokensReceived,
  toolStarted,
  toolFinished,
  streamFailed,
  streamStopped,
  liveCopySaved,
  streamCleared,
} = chatSlice.actions;
export const chatReducer = chatSlice.reducer;
