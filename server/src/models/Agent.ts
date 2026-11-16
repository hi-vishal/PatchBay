import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { LLM_PROVIDERS, jsonOptions } from './shared.js';

const agentSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    systemPrompt: { type: String, default: '', maxlength: 20_000 },
    model: {
      provider: { type: String, enum: LLM_PROVIDERS, required: true },
      name: { type: String, required: true, trim: true },
      temperature: { type: Number, min: 0, max: 2, default: 0.7 },
    },
    tools: { type: [String], default: [] },
    mcpServerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'McpServer' }], default: [] },
    memoryEnabled: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: jsonOptions },
);

agentSchema.index({ ownerId: 1, updatedAt: -1 });

export type AgentAttrs = InferSchemaType<typeof agentSchema>;
export type AgentDoc = HydratedDocument<AgentAttrs>;
export const Agent = model('Agent', agentSchema);
