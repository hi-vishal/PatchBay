import { randomUUID } from 'node:crypto';
import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { jsonOptions } from './shared.js';

const conversationSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent' },
    title: { type: String, default: 'New chat', trim: true, maxlength: 200 },
    // LangGraph checkpoint key for this conversation.
    threadId: { type: String, required: true, unique: true, default: () => randomUUID() },
  },
  { timestamps: true, toJSON: jsonOptions },
);

conversationSchema.index({ ownerId: 1, updatedAt: -1 });

export type ConversationAttrs = InferSchemaType<typeof conversationSchema>;
export type ConversationDoc = HydratedDocument<ConversationAttrs>;
export const Conversation = model('Conversation', conversationSchema);
