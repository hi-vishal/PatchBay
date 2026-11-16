import type { HydratedDocument, InferSchemaType } from 'mongoose';
import { Schema, model } from 'mongoose';
import { WORKFLOW_NODE_TYPES, jsonOptions } from './shared.js';

const nodeSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: WORKFLOW_NODE_TYPES, required: true },
    label: { type: String, default: '' },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false, id: false, minimize: false },
);

const edgeSchema = new Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    // Branch taken from a condition node: 'true' or 'false'.
    sourceHandle: { type: String },
  },
  { _id: false, id: false },
);

const workflowSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 500 },
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    trigger: {
      type: { type: String, enum: ['manual'], default: 'manual' },
    },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

workflowSchema.index({ ownerId: 1, updatedAt: -1 });

export type WorkflowAttrs = InferSchemaType<typeof workflowSchema>;
export type WorkflowDoc = HydratedDocument<WorkflowAttrs>;
export const Workflow = model('Workflow', workflowSchema);
