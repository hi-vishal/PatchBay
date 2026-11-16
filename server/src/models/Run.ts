import { randomUUID } from 'node:crypto';
import type { Document, HydratedDocument, InferSchemaType, Types } from 'mongoose';
import { Schema, model } from 'mongoose';
import { RUN_STATUSES, STEP_STATUSES, jsonOptions } from './shared.js';

interface RunTarget {
  workflowId?: Types.ObjectId | null;
  agentId?: Types.ObjectId | null;
}

const stepSchema = new Schema(
  {
    nodeId: { type: String, required: true },
    nodeType: { type: String, required: true },
    label: { type: String, default: '' },
    status: { type: String, enum: STEP_STATUSES, required: true },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    error: { type: String },
    startedAt: { type: Date },
    // Refreshed while a process is working on the run. A run that stops refreshing was abandoned.
    heartbeatAt: { type: Date },
    endedAt: { type: Date },
  },
  { _id: false, id: false },
);

const runSchema = new Schema(
  {
    // Not in the original brief: runs need a direct owner for ownership checks and listing.
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow' },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent' },
    threadId: { type: String, required: true, default: () => randomUUID() },
    status: { type: String, enum: RUN_STATUSES, default: 'pending', required: true },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    steps: { type: [stepSchema], default: [] },
    // Copy of the workflow when the run started. Loaded only when resuming.
    workflowSnapshot: { type: Schema.Types.Mixed, select: false },
    startedAt: { type: Date },
    // Refreshed while a process is working on the run. A run that stops refreshing was abandoned.
    heartbeatAt: { type: Date },
    endedAt: { type: Date },
    error: { type: String },
  },
  {
    timestamps: true,
    toJSON: {
      ...jsonOptions,
      transform(doc: unknown, ret: Record<string, unknown>) {
        delete ret.workflowSnapshot;
        return jsonOptions.transform(doc, ret);
      },
    },
  },
);

runSchema.pre('validate', function requireOneTarget(this: Document & RunTarget) {
  if (Boolean(this.workflowId) === Boolean(this.agentId)) {
    this.invalidate('workflowId', 'A run targets exactly one of workflowId or agentId');
  }
});

runSchema.index({ ownerId: 1, createdAt: -1 });
runSchema.index({ workflowId: 1, createdAt: -1 });
runSchema.index({ agentId: 1, createdAt: -1 });

export type RunAttrs = InferSchemaType<typeof runSchema>;
export type RunDoc = HydratedDocument<RunAttrs>;
export const Run = model('Run', runSchema);
