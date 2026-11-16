import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { Run, Workflow } from '../src/models/index.js';
import { parseWorkflow } from '../src/services/graphs/workflowDefinition.js';
import { evaluateCondition, renderTemplate } from '../src/services/graphs/workflowDefinition.js';
import { routeBranch } from '../src/services/graphs/workflowGraph.js';
import { RUN_STALE_MS, failAbandonedRuns } from '../src/services/graphs/workflowRunner.js';
import type * as LlmModule from '../src/services/llm/llm.js';
import { useAiTestEnvironment } from './helpers/aiEnv.js';
import { authHeader, createUser } from './helpers/auth.js';
import type { ScriptedReply } from './helpers/scriptedModel.js';
import { ScriptedChatModel } from './helpers/scriptedModel.js';

const llm = vi.hoisted(() => ({ next: undefined as unknown }));

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

vi.mock('../src/services/llm/llm.js', async (importOriginal) => ({
  ...(await importOriginal<typeof LlmModule>()),
  createChatModel: vi.fn(async () => llm.next),
}));

useAiTestEnvironment();

const app = createApp();
const alice = authHeader('alice');

function script(...replies: ScriptedReply[]): ScriptedChatModel {
  const model = new ScriptedChatModel(replies);
  llm.next = model;
  return model;
}

async function waitForRun(id: string, ...statuses: string[]) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { body } = await request(app).get(`/api/runs/${id}`).set(alice);
    if (statuses.includes(body.run?.status)) return body.run;
    if (Date.now() > deadline) throw new Error(`Run stuck: ${JSON.stringify(body.run)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function createWorkflow(nodes: object[], edges: object[] = []): Promise<string> {
  const res = await request(app)
    .post('/api/workflows')
    .set(alice)
    .send({ name: 'Flow', nodes, edges });
  expect(res.status).toBe(201);
  return res.body.workflow.id;
}

async function startRun(workflowId: string, input = 'hello'): Promise<string> {
  const res = await request(app)
    .post(`/api/workflows/${workflowId}/run`)
    .set(alice)
    .send({ input });
  expect(res.status).toBe(202);
  return res.body.run.id;
}

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}`,
  source,
  target,
  sourceHandle,
});

beforeEach(async () => {
  await createUser('alice');
  await createUser('mallory');
});

describe('renderTemplate', () => {
  const values = { input: 'in', last: 'prev', outputs: { a: 'A', 'node-2': 'B' } };

  it('fills known placeholders and blanks the rest', () => {
    expect(renderTemplate('{{input}} {{ last }} {{nodes.a}} {{nodes.node-2}}', values)).toBe(
      'in prev A B',
    );
    expect(renderTemplate('[{{nodes.zzz}}][{{secret}}][{{process.env}}]', values)).toBe('[][][]');
  });
});

describe('evaluateCondition', () => {
  const check = (operator: string, source: string, value = '') =>
    evaluateCondition({ operator, value, source: '' } as never, source);

  it('compares text case-insensitively', () => {
    expect(check('contains', 'Hello World', 'world')).toBe(true);
    expect(check('not_contains', 'Hello', 'world')).toBe(true);
    expect(check('equals', ' YES ', 'yes')).toBe(true);
    expect(check('not_equals', 'yes', 'no')).toBe(true);
  });

  it('compares numbers, and text is never greater or less', () => {
    expect(check('greater_than', '10', '9')).toBe(true);
    expect(check('less_than', '10', '9')).toBe(false);
    expect(check('greater_than', 'abc', '9')).toBe(false);
  });

  it('checks emptiness', () => {
    expect(check('is_empty', '   ')).toBe(true);
    expect(check('not_empty', 'x')).toBe(true);
  });
});

describe('routeBranch', () => {
  const edges = [
    { target: 'yes', sourceHandle: 'true' },
    { target: 'no', sourceHandle: 'false' },
    { target: 'plain', sourceHandle: null },
  ];

  it('follows the true branch and unlabeled edges', () => {
    expect(routeBranch('c', { c: 'true' }, edges)).toEqual(['yes', 'plain']);
    expect(routeBranch('c', { c: 'approved' }, edges)).toEqual(['yes', 'plain']);
  });

  it('follows the false branch', () => {
    expect(routeBranch('c', { c: 'false' }, edges)).toEqual(['no']);
    expect(routeBranch('c', { c: 'rejected' }, edges)).toEqual(['no']);
  });
});

describe('parseWorkflow', () => {
  const llmNode = { id: 'a', type: 'llm', config: { prompt: 'hi' } };

  it('accepts a valid workflow and finds the entry node', () => {
    const parsed = parseWorkflow({
      nodes: [llmNode, { id: 'b', type: 'human_approval' }],
      edges: [edge('a', 'b')],
    });
    expect(parsed.entryNodes).toEqual(['a']);
    expect(parsed.nodes[1]?.config).toEqual({ message: 'Approve this step to continue.' });
  });

  it.each([
    ['no nodes', { nodes: [], edges: [] }, /at least one node/],
    ['unknown type', { nodes: [{ id: 'a', type: 'shell' }], edges: [] }, /unknown type/],
    ['missing prompt', { nodes: [{ id: 'a', type: 'llm' }], edges: [] }, /Node "a"/],
    [
      'unknown tool',
      { nodes: [{ id: 'a', type: 'tool', config: { tool: 'rm' } }], edges: [] },
      /Node "a"/,
    ],
    ['dangling edge', { nodes: [llmNode], edges: [edge('a', 'z')] }, /does not exist/],
    ['no entry', { nodes: [llmNode], edges: [edge('a', 'a')] }, /starting node/],
  ])('rejects %s', (_name, definition, message) => {
    expect(() => parseWorkflow(definition)).toThrow(message);
  });
});

describe('running workflows', () => {
  it('rejects an invalid workflow before creating a run', async () => {
    const id = await createWorkflow([{ id: 'a', type: 'llm' }]);
    const res = await request(app).post(`/api/workflows/${id}/run`).set(alice).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WORKFLOW');
    expect(await Run.countDocuments()).toBe(0);
  });

  it('refuses a disabled workflow', async () => {
    const id = await createWorkflow([{ id: 'a', type: 'llm', config: { prompt: 'x' } }]);
    await request(app).patch(`/api/workflows/${id}`).set(alice).send({ enabled: false });
    const res = await request(app).post(`/api/workflows/${id}/run`).set(alice).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKFLOW_DISABLED');
  });

  it('passes output between llm and tool nodes and logs each step', async () => {
    const model = script({ text: '6 * 7' });
    const id = await createWorkflow(
      [
        { id: 'plan', type: 'llm', label: 'Plan', config: { prompt: 'Write math for: {{input}}' } },
        {
          id: 'calc',
          type: 'tool',
          label: 'Calculate',
          config: { tool: 'calculator', args: { expression: '{{last}}' } },
        },
      ],
      [edge('plan', 'calc')],
    );

    const run = await waitForRun(await startRun(id, 'six times seven'), 'succeeded', 'failed');

    expect(run.status).toBe('succeeded');
    expect(run.output).toBe('42');
    expect(model.seen[0]?.at(-1)?.text).toBe('Write math for: six times seven');
    expect(run.steps.map((step: { nodeId: string; status: string }) => step.nodeId)).toEqual([
      'plan',
      'calc',
    ]);
    expect(run.steps[1]).toMatchObject({
      nodeType: 'tool',
      label: 'Calculate',
      status: 'succeeded',
      output: '42',
      input: { tool: 'calculator', args: { expression: '6 * 7' } },
    });
    expect(run.endedAt).toBeTruthy();
  });

  it('follows only the matching branch of a condition', async () => {
    const nodes = [
      {
        id: 'check',
        type: 'condition',
        config: { source: '{{input}}', operator: 'contains', value: 'urgent' },
      },
      { id: 'high', type: 'tool', config: { tool: 'calculator', args: { expression: '1' } } },
      { id: 'low', type: 'tool', config: { tool: 'calculator', args: { expression: '2' } } },
    ];
    const edges = [edge('check', 'high', 'true'), edge('check', 'low', 'false')];
    const id = await createWorkflow(nodes, edges);

    const urgent = await waitForRun(await startRun(id, 'this is URGENT'), 'succeeded', 'failed');
    expect(urgent.output).toBe('1');
    expect(urgent.steps.map((step: { nodeId: string }) => step.nodeId)).toEqual(['check', 'high']);

    const calm = await waitForRun(await startRun(id, 'no rush'), 'succeeded', 'failed');
    expect(calm.output).toBe('2');
    expect(calm.steps.map((step: { nodeId: string }) => step.nodeId)).toEqual(['check', 'low']);
  });

  it('marks the run failed, with the failing step, when a node throws', async () => {
    const id = await createWorkflow([
      { id: 'bad', type: 'tool', config: { tool: 'calculator', args: { expression: '1 / 0' } } },
    ]);
    const run = await waitForRun(await startRun(id), 'succeeded', 'failed');
    expect(run.status).toBe('failed');
    expect(run.error).toBeTruthy();
    expect(run.steps[0]).toMatchObject({ nodeId: 'bad', status: 'failed' });
    expect(run.steps[0].error).toMatch(/finite/);
  });

  it('refuses an agent owned by another user', async () => {
    script({ text: 'never' });
    const theirs = await request(app)
      .post('/api/agents')
      .set(authHeader('mallory'))
      .send({ name: 'Secret', model: { provider: 'openai', name: 'x' } });
    const id = await createWorkflow([
      { id: 'a', type: 'agent', config: { agentId: theirs.body.agent.id, input: 'leak' } },
    ]);
    const run = await waitForRun(await startRun(id), 'succeeded', 'failed');
    expect(run.status).toBe('failed');
    expect(run.steps[0].error).toMatch(/not found/);
  });

  it('runs an agent node with its tools, without chat memory', async () => {
    const model = script(
      { toolCalls: [{ id: 'c1', name: 'calculator', args: { expression: '2 + 2' } }] },
      { text: 'It is 4' },
    );
    const agent = await request(app)
      .post('/api/agents')
      .set(alice)
      .send({
        name: 'Math',
        systemPrompt: 'Use the calculator',
        model: { provider: 'openai', name: 'x' },
        tools: ['calculator'],
      });
    const id = await createWorkflow([
      { id: 'a', type: 'agent', config: { agentId: agent.body.agent.id, input: '{{input}}' } },
    ]);

    const run = await waitForRun(await startRun(id, 'what is 2 + 2?'), 'succeeded', 'failed');

    expect(run.status).toBe('succeeded');
    expect(run.output).toBe('It is 4');
    expect(model.seen[0]?.[0]?.text).toBe('Use the calculator');
  });
});

describe('human approval', () => {
  const nodes = [
    { id: 'gate', type: 'human_approval', config: { message: 'Ship it?' } },
    { id: 'yes', type: 'tool', config: { tool: 'calculator', args: { expression: '1' } } },
    { id: 'no', type: 'tool', config: { tool: 'calculator', args: { expression: '0' } } },
  ];
  const edges = [edge('gate', 'yes'), edge('gate', 'no', 'false')];

  it('pauses, then continues when approved', async () => {
    const id = await createWorkflow(nodes, edges);
    const runId = await startRun(id);

    const paused = await waitForRun(runId, 'waiting_approval', 'failed');
    expect(paused.status).toBe('waiting_approval');
    expect(paused.steps).toHaveLength(1);
    expect(paused.steps[0]).toMatchObject({
      nodeId: 'gate',
      status: 'waiting_approval',
      input: { message: 'Ship it?' },
    });

    const resumed = await request(app)
      .post(`/api/runs/${runId}/resume`)
      .set(alice)
      .send({ approved: true });
    expect(resumed.status).toBe(202);

    const done = await waitForRun(runId, 'succeeded', 'failed');
    expect(done.status).toBe('succeeded');
    expect(done.output).toBe('1');
    expect(done.steps.map((step: { nodeId: string }) => step.nodeId)).toEqual(['gate', 'yes']);
    expect(done.steps[0]).toMatchObject({ status: 'succeeded', output: 'approved' });
  });

  it('takes the false branch when rejected', async () => {
    const id = await createWorkflow(nodes, edges);
    const runId = await startRun(id);
    await waitForRun(runId, 'waiting_approval');

    await request(app).post(`/api/runs/${runId}/resume`).set(alice).send({ approved: false });

    const done = await waitForRun(runId, 'succeeded', 'failed');
    expect(done.output).toBe('0');
    expect(done.steps[0].output).toBe('rejected');
  });

  it('ends cleanly when rejected and no false branch exists', async () => {
    const id = await createWorkflow(nodes.slice(0, 2), [edge('gate', 'yes')]);
    const runId = await startRun(id);
    await waitForRun(runId, 'waiting_approval');
    await request(app).post(`/api/runs/${runId}/resume`).set(alice).send({ approved: false });
    const done = await waitForRun(runId, 'succeeded', 'failed');
    expect(done.status).toBe('succeeded');
    expect(done.steps).toHaveLength(1);
  });

  it('refuses to resume twice or when the run is not waiting', async () => {
    const id = await createWorkflow(nodes, edges);
    const runId = await startRun(id);
    await waitForRun(runId, 'waiting_approval');

    const results = await Promise.all([
      request(app).post(`/api/runs/${runId}/resume`).set(alice).send({ approved: true }),
      request(app).post(`/api/runs/${runId}/resume`).set(alice).send({ approved: true }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([202, 409]);

    await waitForRun(runId, 'succeeded', 'failed');
    const late = await request(app)
      .post(`/api/runs/${runId}/resume`)
      .set(alice)
      .send({ approved: true });
    expect(late.status).toBe(409);
  });

  it('keeps other users away from runs', async () => {
    const id = await createWorkflow(nodes, edges);
    const runId = await startRun(id);
    await waitForRun(runId, 'waiting_approval');

    const mallory = authHeader('mallory');
    expect((await request(app).get(`/api/runs/${runId}`).set(mallory)).status).toBe(404);
    expect((await request(app).get('/api/runs').set(mallory)).body.items).toHaveLength(0);
    const resume = await request(app)
      .post(`/api/runs/${runId}/resume`)
      .set(mallory)
      .send({ approved: true });
    expect(resume.status).toBe(404);

    const stored = await Run.findById(runId);
    expect(stored?.status).toBe('waiting_approval');
  });

  it('resumes from the snapshot, unaffected by edits or deletion', async () => {
    const id = await createWorkflow(nodes, edges);
    const runId = await startRun(id);
    await waitForRun(runId, 'waiting_approval');

    await Workflow.deleteOne({ _id: id });
    await request(app).post(`/api/runs/${runId}/resume`).set(alice).send({ approved: true });

    const done = await waitForRun(runId, 'succeeded', 'failed');
    expect(done.status).toBe('succeeded');
    expect(done.output).toBe('1');
  });

  it('never exposes the snapshot in API responses', async () => {
    const id = await createWorkflow(nodes, edges);
    const start = await request(app).post(`/api/workflows/${id}/run`).set(alice).send({});
    expect(start.body.run.workflowSnapshot).toBeUndefined();
    await waitForRun(start.body.run.id, 'waiting_approval');
  });
});

describe('runs', () => {
  it('filters by workflow and status', async () => {
    const first = await createWorkflow([
      { id: 'a', type: 'tool', config: { tool: 'calculator', args: { expression: '1' } } },
    ]);
    const second = await createWorkflow([{ id: 'g', type: 'human_approval' }]);
    await waitForRun(await startRun(first), 'succeeded');
    await waitForRun(await startRun(second), 'waiting_approval');

    const byWorkflow = await request(app).get(`/api/runs?workflowId=${first}`).set(alice);
    expect(byWorkflow.body.items).toHaveLength(1);
    const byStatus = await request(app).get('/api/runs?status=waiting_approval').set(alice);
    expect(byStatus.body.items[0].workflowId).toBe(second);
  });

  it('marks in-progress runs failed after a restart, leaving paused ones alone', async () => {
    const owner = await createUser('restart');
    const base = { ownerId: owner._id, workflowId: owner._id };
    const running = await Run.create({ ...base, status: 'running' });
    const paused = await Run.create({ ...base, status: 'waiting_approval' });

    await failAbandonedRuns();

    expect((await Run.findById(running._id))?.status).toBe('failed');
    expect((await Run.findById(paused._id))?.status).toBe('waiting_approval');
  });

  it('leaves runs another process is still working on when several processes share them', async () => {
    const owner = await createUser('fleet');
    const base = { ownerId: owner._id, workflowId: owner._id, status: 'running' as const };
    const alive = await Run.create({ ...base, heartbeatAt: new Date() });
    const silent = await Run.create({
      ...base,
      heartbeatAt: new Date(Date.now() - RUN_STALE_MS - 60_000),
    });

    await failAbandonedRuns(RUN_STALE_MS);

    expect((await Run.findById(alive._id))?.status).toBe('running');
    expect((await Run.findById(silent._id))?.status).toBe('failed');
  });

  it('lets browsers and a CDN keep the public plan list, and compresses large replies', async () => {
    const plans = await request(app).get('/api/billing/plans');
    expect(plans.headers['cache-control']).toContain('public');
    expect(plans.headers['cache-control']).toContain('max-age=300');

    const owner = await createUser('zip');
    await Run.insertMany(
      Array.from({ length: 20 }, () => ({
        ownerId: owner._id,
        workflowId: owner._id,
        status: 'succeeded',
        input: 'x'.repeat(400),
      })),
    );
    const list = await request(app)
      .get('/api/runs')
      .set(authHeader('zip'))
      .set('Accept-Encoding', 'gzip');
    expect(list.status).toBe(200);
    expect(list.headers['content-encoding']).toBe('gzip');
  });
});
