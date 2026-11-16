import cluster from 'node:cluster';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { closeCheckpointer, initCheckpointer } from './services/graphs/checkpointer.js';
import { RUN_STALE_MS, failAbandonedRuns } from './services/graphs/workflowRunner.js';
import { logger } from './utils/logger.js';

/** One API process: its own database connections, HTTP server and run sweeper. */
async function serve(): Promise<void> {
  await connectDatabase(env.MONGODB_URI, env.MONGODB_MAX_POOL_SIZE);
  await initCheckpointer(env.MONGODB_URI);

  // Other processes may be working on runs right now, so only claim the ones that went quiet.
  const sweep = () =>
    failAbandonedRuns(RUN_STALE_MS).catch((err: unknown) =>
      logger.error({ err }, 'Could not sweep abandoned runs'),
    );
  await sweep();
  const sweeper = setInterval(() => void sweep(), 60_000);
  sweeper.unref();

  const server = createApp().listen(env.PORT, () => {
    logger.info({ port: env.PORT, pid: process.pid }, 'API listening');
  });
  // Longer than a load balancer's idle timeout, so it never reuses a socket we just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    clearInterval(sweeper);
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      void Promise.allSettled([disconnectDatabase(), closeCheckpointer()]).finally(() =>
        process.exit(0),
      );
    });
    // Open chat streams would otherwise hold the server open until the timeout.
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** Starts WEB_CONCURRENCY API processes on one port and replaces any that die. */
function supervise(count: number): void {
  let stopping = false;
  logger.info({ workers: count }, 'Starting API workers');
  for (let index = 0; index < count; index += 1) cluster.fork();

  cluster.on('exit', (worker, code) => {
    if (stopping) return;
    logger.error({ pid: worker.process.pid, code }, 'API worker exited, starting another');
    cluster.fork();
  });

  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

if (cluster.isPrimary && env.WEB_CONCURRENCY > 1) {
  supervise(env.WEB_CONCURRENCY);
} else {
  serve().catch((err: unknown) => {
    logger.fatal({ err }, 'API failed to start');
    process.exit(1);
  });
}
