import { z } from 'zod';
import { LLM_PROVIDERS } from '../../models/shared.js';

export const modelConfigSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  name: z.string().trim().min(1).max(200),
  temperature: z.number().min(0).max(2).default(0.7),
});
