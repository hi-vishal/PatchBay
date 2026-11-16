import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { PLANS, jsonOptions } from './shared.js';

const userSchema = new Schema(
  {
    firebaseUid: { type: String, required: true, unique: true },
    email: { type: String, default: '', lowercase: true, trim: true },
    name: { type: String, default: '', trim: true },
    photoURL: { type: String, default: '' },
    plan: { type: String, enum: PLANS, default: 'free', required: true },
    razorpayCustomerId: { type: String },
    // Set when the user redeems a promo code. It sits beside `plan` rather than replacing it,
    // so billing events never undo it and revoking the code falls back to the paid plan.
    promoCodeId: { type: Schema.Types.ObjectId, ref: 'PromoCode' },
    unlimitedSince: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      ...jsonOptions,
      // The API reports the plan the user actually has, and keeps which code granted it private.
      transform(doc: unknown, ret: Record<string, unknown>) {
        jsonOptions.transform(doc, ret);
        if (ret.promoCodeId) ret.plan = 'unlimited';
        delete ret.promoCodeId;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);
