import { Command } from '@langchain/langgraph';
import type { RunDoc, WorkflowDoc } from '../../models/index.js';
import { Run } from '../../models/index.js';
import { AppError, conflict, errorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { getCheckpointer } from './checkpointer.js';
import { toClientError } from './turn.js';
import type { ParsedNode, WorkflowDefinition } from './workflowDefinition.js';
import { parseWorkflow } from './workflowDefinition.js';
import type { ApprovalDecision, StepRecorder } from './workflowGraph.js';
import { compileWorkflowGraph } from './workflowGraph.js';

const RECURSION_LIMIT = 50;
const MAX_STEP_VALUE_CHARS = 20_000;

interface RunnableGraph {
  invoke(input: unknown, config: Record<string, unknown>): Promise<unknown>;
  getState(config: Record<string, unknown>): Promise<{
    values: { last?: string };
    tasks: { interrupts?: { value: unknown }[] }[];
  }>;
}

interface StepEntry {
  nodeId: string;
  nodeType: string;
  label: string;
  status: 'running' | 'succeeded' | 'failed' | 'waiting_approval';
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: Date;
  endedAt?: Date;
}

function clipValue(value: unknown): unknown {
  return typeof value === 'string' && value.length > MAX_STEP_VALUE_CHARS
    ? `${value.slice(0, MAX_STEP_VALUE_CHARS)}\n[truncated]`
    : value;
}

/** Keeps Run.steps current. Writes go through a queue so parallel nodes cannot reorder them. */
class RunStepRecorder implements StepRecorder {
  private readonly steps: StepEntry[];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly runId: RunDoc['_id'],
    existing: StepEntry[],
  ) {
    this.steps = existing;
  }

  private persist(): Promise<void> {
    const snapshot = this.steps.map((step) => ({ ...step }));
    this.queue = this.queue
      .then(() => Run.updateOne({ _id: this.runId }, { $set: { steps: snapshot } }))
      .catch((error: unknown) => {
        logger.error({ error: errorMessage(error) }, 'Could not save run steps');
      });
    return this.queue.then(() => undefined);
  }

  private find(nodeId: string): StepEntry | undefined {
    return this.steps.findLast((step) => step.nodeId === nodeId);
  }

  start(node: ParsedNode, input: unknown): Promise<void> {
    // An approval node runs again on resume. That continues its step rather than adding one.
    const paused = this.find(node.id);
    if (paused?.status === 'waiting_approval') {
      paused.status = 'running';
      return this.persist();
    }
    this.steps.push({
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      status: 'running',
      input,
      startedAt: new Date(),
    });
    return this.persist();
  }

  succeed(nodeId: string, output: unknown): Promise<void> {
    const step = this.find(nodeId);
    if (step) {
      step.status = 'succeeded';
      step.output = clipValue(output);
      step.endedAt = new Date();
    }
    return this.persist();
  }

  fail(nodeId: string, error: string): Promise<void> {
    const step = this.find(nodeId);
    if (step) {
      step.status = 'failed';
      step.error = error;
      step.endedAt = new Date();
    }
    return this.persist();
  }

  wait(nodeId: string): Promise<void> {
    const step = this.find(nodeId);
    if (step) step.status = 'waiting_approval';
    return this.persist();
  }
}

function plainSteps(run: RunDoc): StepEntry[] {
  return (run.toObject().steps ?? []) as StepEntry[];
}

async function execute(run: RunDoc, definition: WorkflowDefinition, input: unknown): Promise<void> {
  const config = { configurable: { thread_id: run.threadId }, recursionLimit: RECURSION_LIMIT };
  const stopHeartbeat = startHeartbeat(run._id);
  try {
    const graph = compileWorkflowGraph(parseWorkflow(definition), {
      ownerId: run.ownerId,
      checkpointer: getCheckpointer(),
      steps: new RunStepRecorder(run._id, plainSteps(run)),
    }) as RunnableGraph;

    await graph.invoke(input, config);

    const state = await graph.getState(config);
    const waiting = state.tasks.some((task) => (task.interrupts?.length ?? 0) > 0);
    await Run.updateOne(
      { _id: run._id },
      waiting
        ? { $set: { status: 'waiting_approval' } }
        : { $set: { status: 'succeeded', output: state.values.last ?? '', endedAt: new Date() } },
    );
  } catch (error) {
    logger.error({ runId: run._id.toString(), error: errorMessage(error) }, 'Workflow run failed');
    await Run.updateOne(
      { _id: run._id },
      { $set: { status: 'failed', error: toClientError(error).message, endedAt: new Date() } },
    );
  } finally {
    stopHeartbeat();
  }
}

/**
 * Validates the workflow, records a run and starts it in the background. The workflow is copied
 * into the run, so editing it later cannot change a run that is paused for approval.
 */
export async function startWorkflowRun(workflow: WorkflowDoc, input: string): Promise<RunDoc> {
  if (!workflow.enabled) throw new AppError(409, 'WORKFLOW_DISABLED', 'This workflow is disabled');

  const { nodes, edges } = workflow.toObject() as unknown as WorkflowDefinition;
  const definition: WorkflowDefinition = { nodes, edges };
  parseWorkflow(definition);

  const run = await Run.create({
    ownerId: workflow.ownerId,
    workflowId: workflow._id,
    status: 'running',
    input,
    workflowSnapshot: definition,
    startedAt: new Date(),
    heartbeatAt: new Date(),
  });
  void execute(run, definition, { input });
  return run;
}

/** Resumes a paused run. The status flip is atomic, so a double click cannot resume it twice. */
export async function resumeWorkflowRun(
  runId: string,
  ownerId: RunDoc['ownerId'],
  decision: ApprovalDecision,
): Promise<RunDoc> {
  const run = await Run.findOneAndUpdate(
    { _id: runId, ownerId, status: 'waiting_approval' },
    { $set: { status: 'running', heartbeatAt: new Date() } },
    { returnDocument: 'after' },
  ).select('+workflowSnapshot');

  if (!run) {
    const exists = await Run.exists({ _id: runId, ownerId });
    if (!exists) throw new AppError(404, 'NOT_FOUND', 'Run not found');
    throw conflict('This run is not waiting for approval');
  }

  void execute(
    run,
    run.get('workflowSnapshot') as WorkflowDefinition,
    new Command({ resume: decision }),
  );
  return run;
}

const HEARTBEAT_MS = 30_000;

/** How long a run may go without a heartbeat before another process treats it as abandoned. */
export const RUN_STALE_MS = 5 * 60_000;

/** Keeps a run marked as alive while this process works on it. Call the result to stop. */
function startHeartbeat(runId: RunDoc['_id']): () => void {
  const timer = setInterval(() => {
    void Run.updateOne({ _id: runId }, { $set: { heartbeatAt: new Date() } }).catch(
      () => undefined,
    );
  }, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Background runs do not survive the process that started them. Marks them failed so they do not
 * look stuck. With `staleMs` at zero every unfinished run counts, which is right for one process.
 * With several processes, pass RUN_STALE_MS so a restart only claims runs nobody is working on.
 */
export async function failAbandonedRuns(staleMs = 0): Promise<void> {
  const cutoff = new Date(Date.now() - staleMs);
  const { modifiedCount } = await Run.updateMany(
    {
      status: { $in: ['pending', 'running'] },
      ...(staleMs > 0 && {
        $or: [
          { heartbeatAt: { $lt: cutoff } },
          { heartbeatAt: { $exists: false }, updatedAt: { $lt: cutoff } },
        ],
      }),
    },
    {
      $set: {
        status: 'failed',
        error: 'The server restarted while this run was in progress.',
        endedAt: new Date(),
      },
    },
  );
  if (modifiedCount > 0) logger.warn({ modifiedCount }, 'Marked abandoned runs as failed');
}
