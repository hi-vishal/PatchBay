import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { currentUser } from '../middleware/protect.js';
import { Subscription, WebhookEvent } from '../models/index.js';
import { billingConfigured, listPlans } from '../services/billing/plans.js';
import { redeemPromoCode } from '../services/billing/promoCodes.js';
import {
  cancelRazorpaySubscription,
  createRazorpaySubscription,
  fetchRazorpaySubscription,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/billing/razorpay.js';
import {
  findEntitledSubscription,
  findUnpaidSubscriptions,
  syncSubscription,
} from '../services/billing/subscriptions.js';
import { AppError, conflict, notFound, serviceUnavailable } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SETTLE_ATTEMPTS = 3;
const SETTLE_WAIT_MS = 1000;

export function getPlans(_req: Request, res: Response): void {
  // The same for every visitor and rarely changed, so browsers and any CDN in front may keep it.
  // That keeps a busy landing page from reaching the API on every view.
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  res.json({ items: listPlans() });
}

function checkoutDetails(subscriptionId: string) {
  return { subscriptionId, keyId: env.RAZORPAY_KEY_ID };
}

const alreadySubscribed = () => conflict('You already have an active subscription.');

export async function subscribe(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  if (user.promoCodeId) throw conflict('Your account already has unlimited use.');
  if (!billingConfigured() || !env.RAZORPAY_PRO_PLAN_ID) {
    throw serviceUnavailable(
      'BILLING_NOT_CONFIGURED',
      'Payments are not set up on this server yet.',
    );
  }
  if (await findEntitledSubscription(user._id)) throw alreadySubscribed();

  // Reopening checkout continues the earlier attempt rather than leaving another one behind. It
  // asks Razorpay first: the customer may have paid without this server hearing about it, and
  // Checkout cannot take a first payment twice.
  const unfinished = await Subscription.findOne({
    userId: user._id,
    status: 'created',
    planId: env.RAZORPAY_PRO_PLAN_ID,
  });
  if (unfinished) {
    const latest = await syncSubscription(
      await fetchRazorpaySubscription(unfinished.razorpaySubscriptionId),
    );
    if (latest?.status === 'created') {
      res.json(checkoutDetails(latest.razorpaySubscriptionId));
      return;
    }
    if (await findEntitledSubscription(user._id)) throw alreadySubscribed();
  }

  // Razorpay keeps retrying a failed payment, so a second subscription could charge twice. If this
  // cancel fails, the error stops here and no new subscription starts.
  for (const unpaid of await findUnpaidSubscriptions(user._id)) {
    await syncSubscription(await cancelRazorpaySubscription(unpaid.razorpaySubscriptionId, false));
  }

  const created = await createRazorpaySubscription(env.RAZORPAY_PRO_PLAN_ID, user._id.toString());
  await Subscription.create({
    userId: user._id,
    razorpaySubscriptionId: created.id,
    planId: env.RAZORPAY_PRO_PLAN_ID,
    status: 'created',
  });
  res.json(checkoutDetails(created.id));
}

export const redeemSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export async function redeem(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const { code } = req.body as z.infer<typeof redeemSchema>;
  await redeemPromoCode(user._id, code);
  logger.info({ userId: user._id.toString() }, 'Promo code redeemed');
  res.json({ plan: 'unlimited' });
}

export const verifySchema = z.object({
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});

/** Razorpay can report `created` for a moment after Checkout, until the first charge lands. */
async function fetchAfterCheckout(id: string) {
  let entity = await fetchRazorpaySubscription(id);
  for (let attempt = 1; attempt < SETTLE_ATTEMPTS && entity.status === 'created'; attempt += 1) {
    await delay(SETTLE_WAIT_MS);
    entity = await fetchRazorpaySubscription(id);
  }
  return entity;
}

/**
 * Confirms a payment as soon as Checkout returns, by asking Razorpay directly. The webhook does
 * the same job, but it cannot reach a local machine without a tunnel.
 */
export async function verifyCheckout(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const body = req.body as z.infer<typeof verifySchema>;
  if (!env.RAZORPAY_KEY_SECRET) {
    throw serviceUnavailable(
      'BILLING_NOT_CONFIGURED',
      'Payments are not set up on this server yet.',
    );
  }

  const owned = await Subscription.exists({
    userId: user._id,
    razorpaySubscriptionId: body.razorpay_subscription_id,
  });
  if (!owned) throw notFound('Subscription');

  const valid = verifyCheckoutSignature(
    body.razorpay_payment_id,
    body.razorpay_subscription_id,
    body.razorpay_signature,
    env.RAZORPAY_KEY_SECRET,
  );
  if (!valid) throw new AppError(400, 'INVALID_SIGNATURE', 'This payment could not be verified.');

  const entity = await fetchAfterCheckout(body.razorpay_subscription_id);
  const subscription = await syncSubscription(entity);
  res.json({ subscription });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const subscription = await findEntitledSubscription(user._id);
  if (!subscription) throw notFound('Active subscription');

  // Cancels at the end of the paid period, so the customer keeps what they paid for.
  const entity = await cancelRazorpaySubscription(subscription.razorpaySubscriptionId, true);
  subscription.cancelAtCycleEnd = true;
  await subscription.save();
  const updated = await syncSubscription(entity);
  res.json({ subscription: updated });
}

const webhookSchema = z.object({
  event: z.string().min(1),
  created_at: z.number().optional(),
  payload: z
    .object({
      subscription: z
        .object({
          entity: z.looseObject({
            id: z.string().min(1),
            plan_id: z.string().optional(),
            status: z.string().optional(),
            current_end: z.number().nullish(),
            notes: z.unknown().optional(),
          }),
        })
        .optional(),
    })
    .optional(),
});

function parseWebhook(rawBody: Buffer) {
  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Malformed webhook body');
  }
  return webhookSchema.parse(json);
}

/** Receives Razorpay events. Mounted before the JSON parser, because it needs the raw bytes. */
export async function razorpayWebhook(req: Request, res: Response): Promise<void> {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw serviceUnavailable('BILLING_NOT_CONFIGURED', 'Webhook secret is not configured');
  }

  const rawBody = req.body as unknown;
  const signature = req.headers['x-razorpay-signature'];
  if (
    !Buffer.isBuffer(rawBody) ||
    typeof signature !== 'string' ||
    !verifyWebhookSignature(rawBody, signature, secret)
  ) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature does not match');
  }

  const event = parseWebhook(rawBody);
  const headerId = req.headers['x-razorpay-event-id'];
  const eventId =
    typeof headerId === 'string' && headerId
      ? headerId
      : createHash('sha256').update(rawBody).digest('hex');

  // Recording the event first means a retry or duplicate delivery does nothing.
  try {
    await WebhookEvent.create({ eventId, type: event.event });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.json({ received: true, duplicate: true });
      return;
    }
    throw error;
  }

  try {
    const entity = event.payload?.subscription?.entity;
    if (event.event.startsWith('subscription.') && entity) {
      await syncSubscription(entity as Parameters<typeof syncSubscription>[0], {
        event: event.event,
        createdAt: event.created_at,
      });
    } else {
      logger.info({ type: event.event }, 'Ignored webhook event');
    }
  } catch (error) {
    // Forgetting the event lets Razorpay's retry process it again.
    await WebhookEvent.deleteOne({ eventId });
    throw error;
  }

  res.json({ received: true });
}
