import type { Types } from 'mongoose';
import { Agent } from '../../models/Agent.js';
import { McpServer } from '../../models/McpServer.js';
import type { EffectivePlan } from '../../models/shared.js';
import { UsageCounter } from '../../models/UsageCounter.js';
import { Workflow } from '../../models/Workflow.js';
import { AppError } from '../../utils/errors.js';
import { PLAN_LIMITS } from './plans.js';

export type MeteredField = 'messages' | 'runs';
export type CountedResource = 'agents' | 'mcpServers' | 'workflows';

const FIELD_LIMITS = { messages: 'messagesPerMonth', runs: 'runsPerMonth' } as const;

function allowance(resource: CountedResource | MeteredField, limit: number): string {
  const count = limit.toLocaleString('en-IN');
  switch (resource) {
    case 'messages':
      return `${count} messages a month`;
    case 'runs':
      return `${count} workflow runs a month`;
    case 'agents':
      return limit === 1 ? '1 agent' : `${count} agents`;
    case 'mcpServers':
      return limit === 1 ? '1 MCP server' : `${count} MCP servers`;
    case 'workflows':
      return limit === 1 ? '1 workflow' : `${count} workflows`;
  }
}

/** The billing period for a date: its calendar month in UTC, as YYYY-MM. */
export function currentPeriod(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function planLimitError(
  resource: CountedResource | MeteredField,
  plan: EffectivePlan,
  limit: number,
) {
  const upgrade = plan === 'free' ? ' Upgrade to Pro for more.' : '';
  return new AppError(
    402,
    'PLAN_LIMIT_REACHED',
    `The ${plan} plan includes ${allowance(resource, limit)}, and you have reached that limit.${upgrade}`,
    { resource, limit, plan },
  );
}

/**
 * Takes one unit of the month's allowance, or throws a 402. The increment and the limit check are
 * one atomic operation, so parallel requests cannot go over the limit.
 */
export async function reserveUsage(
  userId: Types.ObjectId,
  plan: EffectivePlan,
  field: MeteredField,
): Promise<string> {
  const period = currentPeriod();
  const limit = PLAN_LIMITS[plan][FIELD_LIMITS[field]];

  await UsageCounter.updateOne(
    { userId, period },
    { $setOnInsert: { messages: 0, runs: 0 } },
    { upsert: true },
  ).catch((error: { code?: number }) => {
    // Two first requests of the month can race to create the counter. One winning is enough.
    if (error.code !== 11000) throw error;
  });

  // Unlimited use is still counted, so the dashboard can show it.
  const underLimit = Number.isFinite(limit) ? { [field]: { $lt: limit } } : {};
  const updated = await UsageCounter.findOneAndUpdate(
    { userId, period, ...underLimit },
    { $inc: { [field]: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw planLimitError(field, plan, limit);
  return period;
}

/** Gives back one unit when the work did not happen. Never goes below zero. */
export async function refundUsage(
  userId: Types.ObjectId,
  period: string,
  field: MeteredField,
): Promise<void> {
  await UsageCounter.updateOne({ userId, period, [field]: { $gt: 0 } }, { $inc: { [field]: -1 } });
}

export function countResource(userId: Types.ObjectId, resource: CountedResource): Promise<number> {
  switch (resource) {
    case 'agents':
      return Agent.countDocuments({ ownerId: userId });
    case 'mcpServers':
      return McpServer.countDocuments({ ownerId: userId });
    case 'workflows':
      return Workflow.countDocuments({ ownerId: userId });
  }
}

export async function getUsageSummary(userId: Types.ObjectId) {
  const period = currentPeriod();
  const [counter, agents, mcpServers, workflows] = await Promise.all([
    UsageCounter.findOne({ userId, period }),
    countResource(userId, 'agents'),
    countResource(userId, 'mcpServers'),
    countResource(userId, 'workflows'),
  ]);
  return {
    period,
    messages: counter?.messages ?? 0,
    runs: counter?.runs ?? 0,
    agents,
    mcpServers,
    workflows,
  };
}
