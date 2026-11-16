import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { SUBSCRIPTION_STATUSES, jsonOptions } from './shared.js';

const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    razorpaySubscriptionId: { type: String, required: true, unique: true },
    planId: { type: String, required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'created', required: true },
    currentPeriodEnd: { type: Date },
    // The customer asked to stop. The plan stays active until the paid period ends.
    cancelAtCycleEnd: { type: Boolean, default: false },
    // When Razorpay created the newest webhook event applied here, by Razorpay's clock.
    lastEventAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonOptions },
);

subscriptionSchema.index({ userId: 1, createdAt: -1 });

export type SubscriptionAttrs = InferSchemaType<typeof subscriptionSchema>;
export type SubscriptionDoc = HydratedDocument<SubscriptionAttrs>;
export const Subscription = model('Subscription', subscriptionSchema);
