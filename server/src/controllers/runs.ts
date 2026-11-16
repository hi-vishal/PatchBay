import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/protect.js';
import { RUN_STATUSES, Run, Workflow } from '../models/index.js';
import { resumeWorkflowRun, startWorkflowRun } from '../services/graphs/workflowRunner.js';
import { orNotFound } from '../utils/ownership.js';
import type { IdParams } from '../utils/validation.js';
import { objectId } from '../utils/validation.js';

export const startRunSchema = z.object({
  input: z.string().max(32_000).default(''),
});

export const listRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  workflowId: objectId.optional(),
  agentId: objectId.optional(),
  status: z.enum(RUN_STATUSES).optional(),
});

export const resumeRunSchema = z.object({
  approved: z.boolean(),
  comment: z.string().max(2_000).optional(),
});

export async function runWorkflow(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const { input } = req.body as z.infer<typeof startRunSchema>;
  const workflow = orNotFound(
    await Workflow.findOne({ _id: id, ownerId: currentUser(req)._id }),
    'Workflow',
  );
  const run = await startWorkflowRun(workflow, input);
  res.status(202).json({ run });
}

export async function listRuns(req: Request, res: Response): Promise<void> {
  const { limit, skip, workflowId, agentId, status } = req.query as unknown as z.infer<
    typeof listRunsQuery
  >;
  const items = await Run.find({
    ownerId: currentUser(req)._id,
    ...(workflowId ? { workflowId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(status ? { status } : {}),
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  res.json({ items });
}

export async function getRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const run = orNotFound(await Run.findOne({ _id: id, ownerId: currentUser(req)._id }), 'Run');
  res.json({ run });
}

export async function resumeRun(req: Request, res: Response): Promise<void> {
  const { id } = req.params as IdParams;
  const decision = req.body as z.infer<typeof resumeRunSchema>;
  const run = await resumeWorkflowRun(id, currentUser(req)._id, decision);
  res.status(202).json({ run });
}
