import { Types } from 'mongoose';
import type { SubscriptionDoc } from '../../models/Subscription.js';
import { Subscription } from '../../models/Subscription.js';
import { SUBSCRIPTION_STATUSES } from '../../models/shared.js';
import type { SubscriptionStatus } from '../../models/shared.js';
import { User } from '../../models/User.js';
import { logger } from '../../utils/logger.js';
import type { RazorpaySubscriptionEntity } from './razorpay.js';

/** "authenticated" counts because the card is approved and the first charge follows at once. */
const ENTITLED_STATUSES: SubscriptionStatus[] = ['active', 'authenticated'];
const ENDED_STATUSES: SubscriptionStatus[] = ['cancelled', 'completed', 'expired'];
/** Not paying, but not over: Razorpay keeps retrying `pending`, and the others can be revived. */
const UNPAID_STATUSES: SubscriptionStatus[] = ['pending', 'halted', 'paused'];

export interface WebhookContext {
  event: string;
  /** Unix seconds, from the top level of the webhook payload. */
  createdAt?: number;
}

/** Used when a webhook payload carries no status. */
const STATUS_BY_EVENT: Record<string, SubscriptionStatus> = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.paused': 'paused',
  'subscription.resumed': 'active',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
};

function resolveStatus(entity: RazorpaySubscriptionEntity, event?: string) {
  const status = entity.status as SubscriptionStatus | undefined;
  if (status && SUBSCRIPTION_STATUSES.includes(status)) return status;
  return event ? STATUS_BY_EVENT[event] : undefined;
}

function ownerFromNotes(entity: RazorpaySubscriptionEntity): Types.ObjectId | undefined {
  const notes = entity.notes;
  const userId = notes && !Array.isArray(notes) ? notes.userId : undefined;
  return typeof userId === 'string' && Types.ObjectId.isValid(userId)
    ? new Types.ObjectId(userId)
    : undefined;
}

/**
 * The user's plan follows all their subscriptions, not the one in the latest event. An old
 * subscription ending must not downgrade someone who has since started a new one.
 */
export async function refreshUserPlan(userId: Types.ObjectId): Promise<void> {
  const entitled = await Subscription.exists({ userId, status: { $in: ENTITLED_STATUSES } });
  await User.updateOne({ _id: userId }, { $set: { plan: entitled ? 'pro' : 'free' } });
}

/** Applies Razorpay's view of a subscription. Used by the webhook and by checkout verification. */
export async function syncSubscription(
  entity: RazorpaySubscriptionEntity,
  webhook?: WebhookContext,
): Promise<SubscriptionDoc | null> {
  let subscription = await Subscription.findOne({ razorpaySubscriptionId: entity.id });

  if (!subscription) {
    const userId = ownerFromNotes(entity);
    if (!userId || !(await User.exists({ _id: userId }))) {
      logger.warn(
        { subscriptionId: entity.id, event: webhook?.event },
        'Webhook for an unknown subscription',
      );
      return null;
    }
    subscription = new Subscription({
      userId,
      razorpaySubscriptionId: entity.id,
      planId: entity.plan_id ?? 'unknown',
    });
  }

  const status = resolveStatus(entity, webhook?.event);
  const occurredAt = webhook?.createdAt ? new Date(webhook.createdAt * 1000) : undefined;

  // Razorpay does not promise delivery order, so an older event must not undo a newer one, and
  // nothing revives a subscription that ended. An event that ends one is final, so it always applies.
  const endsIt = status && ENDED_STATUSES.includes(status);
  const alreadyEnded = ENDED_STATUSES.includes(subscription.status);
  const older = occurredAt && subscription.lastEventAt && occurredAt < subscription.lastEventAt;

  if (endsIt || !(alreadyEnded || older)) {
    if (status) subscription.status = status;
    if (entity.current_end) subscription.currentPeriodEnd = new Date(entity.current_end * 1000);
    if (entity.plan_id) subscription.planId = entity.plan_id;
    if (occurredAt) subscription.lastEventAt = occurredAt;
  }
  await subscription.save();

  await refreshUserPlan(subscription.userId);
  return subscription;
}

export function findEntitledSubscription(userId: Types.ObjectId) {
  return Subscription.findOne({ userId, status: { $in: ENTITLED_STATUSES } }).sort({
    createdAt: -1,
  });
}

/** Leaves out one already set to end, because Razorpay allows only one cancel per subscription. */
export function findUnpaidSubscriptions(userId: Types.ObjectId) {
  return Subscription.find({
    userId,
    status: { $in: UNPAID_STATUSES },
    cancelAtCycleEnd: { $ne: true },
  });
}

/** The subscription to show on the billing page. An unfinished checkout does not count. */
export function findCurrentSubscription(userId: Types.ObjectId) {
  return Subscription.findOne({ userId, status: { $ne: 'created' } }).sort({ createdAt: -1 });
}
