import { Router } from 'express';
import { chat, chatSchema, getProviders } from '../controllers/chat.js';
import {
  getLlmSettings,
  getOllamaStatus,
  updateLlmSettings,
  updateLlmSettingsSchema,
} from '../controllers/llmSettings.js';
import { requireUsage } from '../middleware/planGuard.js';
import { protect } from '../middleware/protect.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const chatRouter = Router();
chatRouter.post(
  '/',
  aiLimiter,
  protect,
  validate({ body: chatSchema }),
  requireUsage('messages'),
  chat,
);

export const llmRouter = Router();
llmRouter.get('/providers', protect, getProviders);
llmRouter.get('/settings', protect, getLlmSettings);
llmRouter.patch(
  '/settings',
  aiLimiter,
  protect,
  validate({ body: updateLlmSettingsSchema }),
  updateLlmSettings,
);
// Connects out to an address the user chose, so it shares the tighter limit.
llmRouter.get('/ollama/status', aiLimiter, protect, getOllamaStatus);
