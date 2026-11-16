import type { InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';

const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  processedAt: { type: Date, default: () => new Date() },
});

export type WebhookEventAttrs = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
