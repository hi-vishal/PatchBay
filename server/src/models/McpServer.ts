import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { MCP_TRANSPORTS } from './shared.js';

const mcpServerSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    transport: { type: String, enum: MCP_TRANSPORTS, required: true },
    url: { type: String },
    command: { type: String },
    args: { type: [String], default: [] },
    // AES-256-GCM ciphertext of the credentials. Never returned by the API.
    encryptedAuth: { type: String },
    enabled: { type: Boolean, default: true },
    lastToolSync: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        ret.hasAuth = Boolean(ret.encryptedAuth);
        delete ret.encryptedAuth;
        return ret;
      },
    },
  },
);

mcpServerSchema.index({ ownerId: 1, updatedAt: -1 });

export type McpServerAttrs = InferSchemaType<typeof mcpServerSchema>;
export type McpServerDoc = HydratedDocument<McpServerAttrs>;
export const McpServer = model('McpServer', mcpServerSchema);
