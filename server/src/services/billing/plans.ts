import { env } from '../../config/env.js';
import type { UserDoc } from '../../models/User.js';
import type { EffectivePlan } from '../../models/shared.js';

export interface PlanLimits {
  messagesPerMonth: number;
  runsPerMonth: number;
  agents: number;
  mcpServers: number;
  workflows: number;
}

const NO_LIMIT = Number.POSITIVE_INFINITY;

/** `Infinity` means no limit. It reaches the client as `null`, because that is how JSON writes it. */
export const PLAN_LIMITS: Record<EffectivePlan, PlanLimits> = {
  free: { messagesPerMonth: 50, runsPerMonth: 20, agents: 2, mcpServers: 1, workflows: 2 },
  pro: { messagesPerMonth: 2000, runsPerMonth: 500, agents: 50, mcpServers: 20, workflows: 50 },
  unlimited: {
    messagesPerMonth: NO_LIMIT,
    runsPerMonth: NO_LIMIT,
    agents: NO_LIMIT,
    mcpServers: NO_LIMIT,
    workflows: NO_LIMIT,
  },
};

/** The plan whose limits apply. A redeemed promo code wins over whatever billing says. */
export function effectivePlan(user: Pick<UserDoc, 'plan' | 'promoCodeId'>): EffectivePlan {
  return user.promoCodeId ? 'unlimited' : user.plan;
}

export function billingConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_PRO_PLAN_ID);
}

export function listPlans() {
  return [
    {
      id: 'free' as const,
      name: 'Free',
      price: '₹0',
      description: 'Try every feature with low limits.',
      limits: PLAN_LIMITS.free,
      available: true,
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: env.PRO_PLAN_PRICE_LABEL,
      description: 'For agents you run every day.',
      limits: PLAN_LIMITS.pro,
      available: billingConfigured(),
    },
  ];
}
