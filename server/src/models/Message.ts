import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { MESSAGE_ROLES, jsonOptions } from './shared.js';

const toolCallSchema = new Schema(
  {
    id: { type: String },
    name: { type: String, required: true },
    args: { type: Schema.Types.Mixed },
    output: { type: String },
    isError: { type: Boolean, default: false },
  },
  { _id: false, id: false },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    role: { type: String, enum: MESSAGE_ROLES, required: true },
    content: { type: String, default: '' },
    toolCalls: { type: [toolCallSchema], default: [] },
    usage: {
      inputTokens: { type: Number, default: 0 },
      outputTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
  },
  { timestamps: true, toJSON: jsonOptions },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

export type MessageAttrs = InferSchemaType<typeof messageSchema>;
export type MessageDoc = HydratedDocument<MessageAttrs>;
export const Message = model('Message', messageSchema);
