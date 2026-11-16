import { describe, expect, it } from 'vitest';
import {
  chatReducer,
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

const start = streamStarted({ message: 'hi', conversationId: null, agentId: null });

describe('chatSlice', () => {
  it('starts clean, dropping anything left from the last stream', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, tokensReceived('old'));
    state = chatReducer(state, start);
    expect(state).toMatchObject({ status: 'streaming', text: '', pendingUserMessage: 'hi' });
  });

  it('accumulates tokens and records the conversation', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, conversationAssigned('c1'));
    state = chatReducer(state, tokensReceived('Hel'));
    state = chatReducer(state, tokensReceived('lo'));
    expect(state.text).toBe('Hello');
    expect(state.conversationId).toBe('c1');
  });

  it('matches a finished tool to its start by id', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, toolStarted({ id: 'a', name: 'calc', input: { x: 1 } }));
    state = chatReducer(state, toolStarted({ id: 'b', name: 'calc', input: { x: 2 } }));
    state = chatReducer(
      state,
      toolFinished({ id: 'a', name: 'calc', output: '1', isError: false }),
    );
    expect(state.steps[0]).toMatchObject({ status: 'done', output: '1' });
    expect(state.steps[1]).toMatchObject({ status: 'running' });
  });

  it('falls back to the tool name when the server sends no id', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, toolStarted({ name: 'calc', input: {} }));
    state = chatReducer(state, toolFinished({ name: 'calc', output: 'nope', isError: true }));
    expect(state.steps[0]).toMatchObject({ status: 'done', isError: true, output: 'nope' });
  });

  it('stops spinning every step when the stream fails', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, toolStarted({ id: 'a', name: 'calc', input: {} }));
    state = chatReducer(state, streamFailed({ code: 'RUN_FAILED', message: 'failed' }));
    expect(state.status).toBe('error');
    expect(state.steps[0]?.status).toBe('done');
    expect(state.error?.code).toBe('RUN_FAILED');
  });

  it('does not show an unfinished step as finished', () => {
    for (const end of [streamFailed({ code: 'X', message: 'failed' }), streamStopped()]) {
      let state = chatReducer(undefined, start);
      state = chatReducer(state, toolStarted({ id: 'a', name: 'calc', input: {} }));
      state = chatReducer(state, toolStarted({ id: 'b', name: 'calc', input: {} }));
      state = chatReducer(
        state,
        toolFinished({ id: 'a', name: 'calc', output: '1', isError: false }),
      );
      state = chatReducer(state, end);
      expect(state.steps[0]).toMatchObject({ status: 'done', isError: false });
      expect(state.steps[1]).toMatchObject({ status: 'done', isError: true });
    }
  });

  it('remembers what to retry after the live copy is replaced by saved messages', () => {
    let state = chatReducer(undefined, start);
    state = chatReducer(state, tokensReceived('Partial'));
    state = chatReducer(state, streamFailed({ code: 'RUN_FAILED', message: 'failed' }));
    state = chatReducer(state, liveCopySaved());
    expect(state).toMatchObject({
      status: 'error',
      pendingUserMessage: null,
      text: '',
      steps: [],
      lastMessage: 'hi',
      error: { code: 'RUN_FAILED' },
    });
  });

  it('marks a stream as starting a new chat only when it has no conversation yet', () => {
    expect(chatReducer(undefined, start).startedNewChat).toBe(true);
    const existing = streamStarted({ message: 'hi', conversationId: 'c1', agentId: null });
    expect(chatReducer(undefined, existing).startedNewChat).toBe(false);
  });

  it('resets when cleared', () => {
    const state = chatReducer(chatReducer(undefined, start), streamCleared());
    expect(state.status).toBe('idle');
    expect(state.pendingUserMessage).toBeNull();
  });
});
