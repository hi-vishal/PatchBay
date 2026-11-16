import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { LLM_PROVIDERS } from './shared.js';

const credentialSchema = new Schema(
  {
    provider: { type: String, enum: LLM_PROVIDERS, required: true },
    // AES-256-GCM ciphertext of the API key. Never returned by the API.
    encryptedKey: { type: String },
    // The last few characters, so people can tell which key they saved.
    keyHint: { type: String },
    modelName: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const defaultModelSchema = new Schema(
  {
    provider: { type: String, enum: LLM_PROVIDERS, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
  },
  { _id: false },
);

/**
 * One document per user, kept apart from User so that key material cannot reach an API response
 * through the user object. Controllers build their responses field by field.
 */
const llmSettingsSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    credentials: { type: [credentialSchema], default: [] },
    defaultModel: { type: defaultModelSchema },
    ollamaBaseUrl: { type: String, trim: true },
  },
  { timestamps: true },
);

export type LlmSettingsAttrs = InferSchemaType<typeof llmSettingsSchema>;
export type LlmSettingsDoc = HydratedDocument<LlmSettingsAttrs>;
export const LlmSettings = model('LlmSettings', llmSettingsSchema);
