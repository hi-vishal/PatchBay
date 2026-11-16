import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import {
  createRazorpaySubscription,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../src/services/billing/razorpay.js';
import { logger } from '../src/utils/logger.js';

const sdk = vi.hoisted(() => ({ create: vi.fn(), fetch: vi.fn(), cancel: vi.fn() }));

vi.mock('razorpay', () => ({
  default: class {
    subscriptions = sdk;
  },
}));

const KEY_SECRET = 'a-key-secret';

describe('webhook signature check', () => {
  const body = Buffer.from('{"event":"subscription.charged"}');
  const secret = 'whsec';
  const good = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the HMAC of the exact bytes', () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    const other = createHmac('sha256', 'other').update(body).digest('hex');
    expect(verifyWebhookSignature(body, other, secret)).toBe(false);
  });

  it('rejects the same JSON with different spacing', () => {
    const respaced = Buffer.from('{"event": "subscription.charged"}');
    expect(verifyWebhookSignature(respaced, good, secret)).toBe(false);
  });

  it.each([undefined, '', 'short', good.toUpperCase()])('rejects %j without throwing', (bad) => {
    expect(verifyWebhookSignature(body, bad, secret)).toBe(false);
  });
});

describe('Checkout signature check', () => {
  const sign = (text: string) => createHmac('sha256', KEY_SECRET).update(text).digest('hex');

  it('signs the payment id, a bar, and the subscription id', () => {
    expect(verifyCheckoutSignature('pay_1', 'sub_1', sign('pay_1|sub_1'), KEY_SECRET)).toBe(true);
  });

  it('rejects a signature for another subscription', () => {
    expect(verifyCheckoutSignature('pay_1', 'sub_2', sign('pay_1|sub_1'), KEY_SECRET)).toBe(false);
  });
});

describe('when Razorpay fails', () => {
  beforeEach(() => {
    env.RAZORPAY_KEY_ID = 'rzp_test_key';
    env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  afterEach(() => {
    env.RAZORPAY_KEY_ID = undefined;
    env.RAZORPAY_KEY_SECRET = undefined;
    vi.restoreAllMocks();
  });

  it('gives a clear error and logs Razorpay’s reason, never the key', async () => {
    const warn = vi.spyOn(logger, 'warn');
    sdk.create.mockRejectedValueOnce({
      statusCode: 400,
      error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' },
    });

    await expect(createRazorpaySubscription('plan_wrong', 'user_1')).rejects.toMatchObject({
      status: 502,
      code: 'PAYMENT_PROVIDER_ERROR',
    });

    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST_ERROR',
      reason: 'The id provided does not exist',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(KEY_SECRET);
  });

  it('handles a network failure, where Razorpay sent no response', async () => {
    sdk.create.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(createRazorpaySubscription('plan_pro', 'user_1')).rejects.toMatchObject({
      status: 502,
    });
  });

  it('still says when payments are not set up', async () => {
    env.RAZORPAY_KEY_SECRET = undefined;
    await expect(createRazorpaySubscription('plan_pro', 'user_1')).rejects.toMatchObject({
      status: 503,
      code: 'BILLING_NOT_CONFIGURED',
    });
  });
});
