import type { Response } from 'express';

const HEARTBEAT_MS = 15_000;

export interface SseStream {
  send: (event: string, data: unknown) => void;
  close: () => void;
  /** Aborts when the client disconnects. */
  signal: AbortSignal;
}

/** Starts a server-sent event response. Comment lines keep idle proxies from closing it. */
export function openSse(res: Response): SseStream {
  const controller = new AbortController();

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref();

  res.on('close', () => {
    clearInterval(heartbeat);
    if (!res.writableFinished) controller.abort();
  });

  return {
    signal: controller.signal,
    send(event, data) {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}
