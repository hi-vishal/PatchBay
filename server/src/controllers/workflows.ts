import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/protect.js';
import { WORKFLOW_NODE_TYPES, Workflow } from '../models/index.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams, ListQuery } from '../utils/validation.js';

const nodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(WORKFLOW_NODE_TYPES),
  label: z.string().max(200).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  // Drafts may be incomplete. Each node's config is fully validated when the workflow runs.
  config: z.record(z.string(), z.unknown()).optional(),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  sourceHandle: z.string().max(50).nullish(),
});

interface GraphFields {
  nodes?: z.infer<typeof nodeSchema>[];
  edges?: z.infer<typeof edgeSchema>[];
}

function checkGraphShape(value: GraphFields, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  for (const node of value.nodes ?? []) {
    if (ids.has(node.id)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate node id: ${node.id}`, path: ['nodes'] });
    }
    ids.add(node.id);
  }
  // A partial update may send edges alone, and those get checked against saved nodes on run.
  if (!value.nodes) return;
  for (const edge of value.edges ?? []) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      ctx.addIssue({
        code: 'custom',
        message: `Edge ${edge.id} references a missing node`,
        path: ['edges'],
      });
    }
  }
}

const workflowFields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  nodes: z.array(nodeSchema).max(100).optional(),
  edges: z.array(edgeSchema).max(300).optional(),
  enabled: z.boolean().optional(),
};

export const createWorkflowSchema = z.object(workflowFields).superRefine(checkGraphShape);
export const updateWorkflowSchema = z.object(workflowFields).partial().superRefine(checkGraphShape);

export async function listWorkflows(req: Request, res: Response): Promise<void> {
  const { limit, skip } = req.query as unknown as ListQuery;
  const items = await Workflow.find({ ownerId: currentUser(req)._id })
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({ items });
}

export async function createWorkflow(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof createWorkflowSchema>;
  const workflow = await Workflow.create({ ...body, ownerId: currentUser(req)._id });
  res.status(201).json({ workflow });
}

export async function getWorkflow(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const workflow = orNotFound(
    await Workflow.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Workflow',
  );
  res.json({ workflow });
}

export async function updateWorkflow(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const workflow = orNotFound(
    await Workflow.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Workflow',
  );
  workflow.set(req.body as z.infer<typeof updateWorkflowSchema>);
  await workflow.save();
  res.json({ workflow });
}

export async function deleteWorkflow(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  orNotFound(
    await Workflow.findOneAndDelete({ _id: id, ownerId: currentUser(req)._id }),
    'Workflow',
  );
  res.status(204).end();
}
