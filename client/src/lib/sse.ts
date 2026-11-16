import type { ApiErrorBody } from '@/lib/types';
import { getIdToken } from '@/lib/auth';

export interface SseEvent {
  event: string;
  data: unknown;
}

/** Splits a stream buffer into complete events, and returns what is left for the next chunk. */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';

  for (const block of blocks) {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      // Lines starting with a colon are heartbeats.
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    try {
      events.push({ event, data: JSON.parse(dataLines.join('\n')) });
    } catch {
      // A malformed event is dropped, so it cannot end the rest of the stream.
    }
  }
  return { events, rest };
}

export class StreamRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StreamRequestError';
  }
}

export interface StreamOptions {
  url: string;
  body: unknown;
  signal: AbortSignal;
  onResponse?: (response: Response) => void;
  onEvent: (event: SseEvent) => void;
}

/** POSTs and reads the SSE response. EventSource cannot send a POST or an auth header. */
export async function streamSse({ url, body, signal, onResponse, onEvent }: StreamOptions) {
  const token = await getIdToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new StreamRequestError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? 'The request failed. Try again.',
    );
  }

  onResponse?.(response);

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseBuffer(buffer);
    buffer = rest;
    for (const event of events) onEvent(event);
  }
}
