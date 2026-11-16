import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { jsonOptions } from './shared.js';

/** A code that gives unlimited use. Only a hash of the code is stored, never the code itself. */
const promoCodeSchema = new Schema(
  {
    codeHash: { type: String, required: true, unique: true, select: false },
    // The last characters of the code, so the owner can tell codes apart in a list.
    hint: { type: String, required: true },
    label: { type: String, default: '', trim: true, maxlength: 100 },
    maxRedemptions: { type: Number, required: true, min: 1, default: 1 },
    redeemedBy: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export type PromoCodeAttrs = InferSchemaType<typeof promoCodeSchema>;
export type PromoCodeDoc = HydratedDocument<PromoCodeAttrs>;
export const PromoCode = model('PromoCode', promoCodeSchema);
