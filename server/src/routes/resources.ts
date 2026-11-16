import { Router } from 'express';
import * as agents from '../controllers/agents.js';
import { agentChat, agentChatSchema } from '../controllers/chat.js';
import * as conversations from '../controllers/conversations.js';
import * as mcpServers from '../controllers/mcpServers.js';
import { runWorkflow, startRunSchema } from '../controllers/runs.js';
import * as workflows from '../controllers/workflows.js';
import { requireCapacity, requireUsage } from '../middleware/planGuard.js';
import { protect } from '../middleware/protect.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { idParams, listQuery } from '../utils/validation.js';

export const agentsRouter = Router();
agentsRouter.use(protect);
agentsRouter.get('/', validate({ query: listQuery }), agents.listAgents);
agentsRouter.post(
  '/',
  validate({ body: agents.createAgentSchema }),
  requireCapacity('agents'),
  agents.createAgent,
);
agentsRouter.get('/:id', validate({ params: idParams }), agents.getAgent);
agentsRouter.patch(
  '/:id',
  validate({ params: idParams, body: agents.updateAgentSchema }),
  agents.updateAgent,
);
agentsRouter.delete('/:id', validate({ params: idParams }), agents.deleteAgent);
agentsRouter.post(
  '/:id/chat',
  aiLimiter,
  validate({ params: idParams, body: agentChatSchema }),
  requireUsage('messages'),
  agentChat,
);

export const conversationsRouter = Router();
conversationsRouter.use(protect);
conversationsRouter.get(
  '/',
  validate({ query: conversations.listConversationsQuery }),
  conversations.listConversations,
);
conversationsRouter.post(
  '/',
  validate({ body: conversations.createConversationSchema }),
  conversations.createConversation,
);
conversationsRouter.get('/:id', validate({ params: idParams }), conversations.getConversation);
conversationsRouter.patch(
  '/:id',
  validate({ params: idParams, body: conversations.updateConversationSchema }),
  conversations.updateConversation,
);
conversationsRouter.delete(
  '/:id',
  validate({ params: idParams }),
  conversations.deleteConversation,
);
conversationsRouter.get(
  '/:id/messages',
  validate({ params: idParams, query: listQuery }),
  conversations.listMessages,
);

export const mcpServersRouter = Router();
mcpServersRouter.use(protect);
mcpServersRouter.get('/', validate({ query: listQuery }), mcpServers.listMcpServers);
mcpServersRouter.post(
  '/',
  validate({ body: mcpServers.createMcpServerSchema }),
  requireCapacity('mcpServers'),
  mcpServers.createMcpServer,
);
mcpServersRouter.get('/:id', validate({ params: idParams }), mcpServers.getMcpServer);
mcpServersRouter.patch(
  '/:id',
  validate({ params: idParams, body: mcpServers.updateMcpServerSchema }),
  mcpServers.updateMcpServer,
);
mcpServersRouter.delete('/:id', validate({ params: idParams }), mcpServers.deleteMcpServer);
mcpServersRouter.post('/:id/test', validate({ params: idParams }), mcpServers.testMcpServer);
mcpServersRouter.get('/:id/tools', validate({ params: idParams }), mcpServers.listMcpServerTools);

export const workflowsRouter = Router();
workflowsRouter.use(protect);
workflowsRouter.get('/', validate({ query: listQuery }), workflows.listWorkflows);
workflowsRouter.post(
  '/',
  validate({ body: workflows.createWorkflowSchema }),
  requireCapacity('workflows'),
  workflows.createWorkflow,
);
workflowsRouter.get('/:id', validate({ params: idParams }), workflows.getWorkflow);
workflowsRouter.patch(
  '/:id',
  validate({ params: idParams, body: workflows.updateWorkflowSchema }),
  workflows.updateWorkflow,
);
workflowsRouter.delete('/:id', validate({ params: idParams }), workflows.deleteWorkflow);
workflowsRouter.post(
  '/:id/run',
  aiLimiter,
  validate({ params: idParams, body: startRunSchema }),
  requireUsage('runs'),
  runWorkflow,
);
