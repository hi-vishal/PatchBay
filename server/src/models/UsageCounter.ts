import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { jsonOptions } from './shared.js';

const usageCounterSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Calendar month in UTC, formatted YYYY-MM.
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    messages: { type: Number, default: 0, min: 0 },
    runs: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);

usageCounterSchema.index({ userId: 1, period: 1 }, { unique: true });

export type UsageCounterAttrs = InferSchemaType<typeof usageCounterSchema>;
export type UsageCounterDoc = HydratedDocument<UsageCounterAttrs>;
export const UsageCounter = model('UsageCounter', usageCounterSchema);
