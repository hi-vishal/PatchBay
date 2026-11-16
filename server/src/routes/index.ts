import { Router } from 'express';
import { authRouter, meRouter } from './auth.js';
import { billingRouter } from './billing.js';
import { chatRouter, llmRouter } from './chat.js';
import { healthRouter } from './health.js';
import {
  agentsRouter,
  conversationsRouter,
  mcpServersRouter,
  workflowsRouter,
} from './resources.js';
import { runsRouter } from './runs.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/agents', agentsRouter);
apiRouter.use('/conversations', conversationsRouter);
apiRouter.use('/mcp-servers', mcpServersRouter);
apiRouter.use('/workflows', workflowsRouter);
apiRouter.use('/runs', runsRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/llm', llmRouter);
apiRouter.use('/billing', billingRouter);
