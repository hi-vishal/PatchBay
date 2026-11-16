import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { env } from '../../config/env.js';
import { AppError, errorMessage, serviceUnavailable } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/** Razorpay needs a fixed cycle count. 120 monthly cycles is the 10 years its guide allows. */
const TOTAL_BILLING_CYCLES = 120;

export interface RazorpaySubscriptionEntity {
  id: string;
  plan_id?: string;
  status?: string;
  current_end?: number | null;
  notes?: Record<string, unknown> | unknown[] | null;
}

let client: Razorpay | undefined;

function razorpay(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw serviceUnavailable(
      'BILLING_NOT_CONFIGURED',
      'Payments are not set up on this server yet.',
    );
  }
  client ??= new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  return client;
}

/**
 * The SDK rejects with a plain `{ statusCode, error }`, so a wrong plan id or an outage would
 * otherwise be an unexplained 500. Logs Razorpay's reason only, since a raw HTTP error holds the key.
 */
async function callRazorpay(
  call: (api: Razorpay) => Promise<unknown>,
): Promise<RazorpaySubscriptionEntity> {
  const api = razorpay();
  try {
    return (await call(api)) as RazorpaySubscriptionEntity;
  } catch (failure) {
    const { statusCode, error } = failure as {
      statusCode?: number;
      error?: { code?: string; description?: string };
    };
    logger.warn(
      { statusCode, code: error?.code, reason: error?.description ?? errorMessage(failure) },
      'Razorpay request failed',
    );
    throw new AppError(
      502,
      'PAYMENT_PROVIDER_ERROR',
      'Razorpay could not complete this request. Try again in a moment.',
    );
  }
}

export function createRazorpaySubscription(
  planId: string,
  userId: string,
): Promise<RazorpaySubscriptionEntity> {
  return callRazorpay((api) =>
    api.subscriptions.create({
      plan_id: planId,
      total_count: TOTAL_BILLING_CYCLES,
      customer_notify: true,
      notes: { userId },
    }),
  );
}

export function fetchRazorpaySubscription(id: string): Promise<RazorpaySubscriptionEntity> {
  return callRazorpay((api) => api.subscriptions.fetch(id));
}

export function cancelRazorpaySubscription(
  id: string,
  atCycleEnd: boolean,
): Promise<RazorpaySubscriptionEntity> {
  return callRazorpay((api) => api.subscriptions.cancel(id, atCycleEnd));
}

function safeEqualHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks a webhook against the exact bytes received. Re-serialized JSON would not match. */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Checks the signature Razorpay Checkout returns to the browser after a subscription payment. */
export function verifyCheckoutSignature(
  paymentId: string,
  subscriptionId: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
  return safeEqualHex(expected, signature);
}
