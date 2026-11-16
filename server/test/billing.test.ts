import { createHmac } from 'node:crypto';
import type { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { Subscription, User, WebhookEvent } from '../src/models/index.js';
import type * as RazorpayModule from '../src/services/billing/razorpay.js';
import { AppError } from '../src/utils/errors.js';
import { authHeader, createUser } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

const razorpay = vi.hoisted(() => ({
  createRazorpaySubscription: vi.fn(),
  fetchRazorpaySubscription: vi.fn(),
  cancelRazorpaySubscription: vi.fn(),
}));

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

vi.mock('../src/services/billing/razorpay.js', async (importOriginal) => ({
  ...(await importOriginal<typeof RazorpayModule>()),
  ...razorpay,
}));

// /billing/verify waits between reads of Razorpay. Tests need not sit through it.
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

useTestDatabase();

const app = createApp();
const alice = authHeader('alice');
const WEBHOOK_SECRET = 'test-webhook-secret';
const KEY_SECRET = 'test-key-secret';
let aliceId: Types.ObjectId;
let eventCounter = 0;

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function postWebhook(
  payload: object,
  options: { signature?: string; eventId?: string; rawBody?: string } = {},
) {
  const body = options.rawBody ?? JSON.stringify(payload);
  eventCounter += 1;
  return request(app)
    .post('/api/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', options.signature ?? sign(body))
    .set('X-Razorpay-Event-Id', options.eventId ?? `evt_${eventCounter}`)
    .send(body);
}

function subscriptionEvent(event: string, entity: Record<string, unknown>) {
  return { event, payload: { subscription: { entity: { id: 'sub_1', ...entity } } } };
}

const planOf = async (id: Types.ObjectId) => (await User.findById(id))?.plan;

beforeEach(async () => {
  vi.clearAllMocks();
  aliceId = (await createUser('alice'))._id;
  env.RAZORPAY_KEY_ID = 'rzp_test_key';
  env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  env.RAZORPAY_PRO_PLAN_ID = 'plan_pro';
  env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  env.RAZORPAY_KEY_ID = undefined;
  env.RAZORPAY_KEY_SECRET = undefined;
  env.RAZORPAY_PRO_PLAN_ID = undefined;
});

describe('webhook signature', () => {
  const event = () => subscriptionEvent('subscription.activated', { status: 'active' });

  it('rejects a missing signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event()));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a wrong signature and changes nothing', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_1',
      planId: 'plan_pro',
    });
    const res = await postWebhook(event(), { signature: sign('other', 'wrong-secret') });
    expect(res.status).toBe(400);
    expect(await planOf(aliceId)).toBe('free');
    expect(await WebhookEvent.countDocuments()).toBe(0);
  });

  it('rejects a tampered body signed for different content', async () => {
    const original = JSON.stringify(event());
    const res = await postWebhook(event(), {
      rawBody: original.replace('active', 'hacked'),
      signature: sign(original),
    });
    expect(res.status).toBe(400);
  });

  it('checks the exact bytes, including whitespace', async () => {
    const pretty = JSON.stringify(event(), null, 2);
    const res = await postWebhook(event(), { rawBody: pretty, signature: sign(pretty) });
    expect(res.status).toBe(200);
  });

  it('refuses when no secret is configured', async () => {
    env.RAZORPAY_WEBHOOK_SECRET = undefined;
    const res = await postWebhook(event());
    expect(res.status).toBe(503);
  });

  it('rejects valid signatures over malformed JSON', async () => {
    const res = await postWebhook({}, { rawBody: 'not json', signature: sign('not json') });
    expect(res.status).toBe(400);
  });
});

describe('webhook events', () => {
  beforeEach(async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_1',
      planId: 'plan_pro',
      status: 'created',
    });
  });

  it('activated upgrades the user', async () => {
    const res = await postWebhook(
      subscriptionEvent('subscription.activated', { status: 'active', current_end: 1_900_000_000 }),
    );
    expect(res.status).toBe(200);
    expect(await planOf(aliceId)).toBe('pro');
    const stored = await Subscription.findOne({ razorpaySubscriptionId: 'sub_1' });
    expect(stored?.status).toBe('active');
    expect(stored?.currentPeriodEnd?.getTime()).toBe(1_900_000_000_000);
  });

  it('charged keeps the user on Pro and moves the period end', async () => {
    await postWebhook(subscriptionEvent('subscription.activated', { status: 'active' }));
    await postWebhook(
      subscriptionEvent('subscription.charged', { status: 'active', current_end: 1_950_000_000 }),
    );
    expect(await planOf(aliceId)).toBe('pro');
    const stored = await Subscription.findOne({ razorpaySubscriptionId: 'sub_1' });
    expect(stored?.currentPeriodEnd?.getTime()).toBe(1_950_000_000_000);
  });

  it('halted downgrades the user', async () => {
    await postWebhook(subscriptionEvent('subscription.activated', { status: 'active' }));
    await postWebhook(subscriptionEvent('subscription.halted', { status: 'halted' }));
    expect(await planOf(aliceId)).toBe('free');
  });

  it('a charge after a halt restores Pro', async () => {
    await postWebhook(subscriptionEvent('subscription.halted', { status: 'halted' }));
    await postWebhook(subscriptionEvent('subscription.charged', { status: 'active' }));
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('cancelled downgrades the user', async () => {
    await postWebhook(subscriptionEvent('subscription.activated', { status: 'active' }));
    await postWebhook(subscriptionEvent('subscription.cancelled', { status: 'cancelled' }));
    expect(await planOf(aliceId)).toBe('free');
  });

  it('falls back to the event name when the payload has no status', async () => {
    await postWebhook(subscriptionEvent('subscription.activated', {}));
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('ignores a late event for a subscription that already ended', async () => {
    await postWebhook(subscriptionEvent('subscription.cancelled', { status: 'cancelled' }));
    await postWebhook(subscriptionEvent('subscription.charged', { status: 'active' }));
    expect(await planOf(aliceId)).toBe('free');
    const stored = await Subscription.findOne({ razorpaySubscriptionId: 'sub_1' });
    expect(stored?.status).toBe('cancelled');
  });

  it('an old subscription ending does not downgrade someone on a newer one', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_2',
      planId: 'plan_pro',
      status: 'active',
    });
    await postWebhook(subscriptionEvent('subscription.cancelled', { status: 'cancelled' }));
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('processes a duplicate delivery only once', async () => {
    const activated = subscriptionEvent('subscription.activated', { status: 'active' });
    await postWebhook(activated, { eventId: 'evt_same' });
    await postWebhook(subscriptionEvent('subscription.halted', { status: 'halted' }));

    const replay = await postWebhook(activated, { eventId: 'evt_same' });

    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(await planOf(aliceId)).toBe('free');
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_same' })).toBe(1);
  });

  it('processes parallel deliveries of one event only once', async () => {
    const activated = subscriptionEvent('subscription.activated', { status: 'active' });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postWebhook(activated, { eventId: 'evt_parallel' })),
    );

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(responses.filter((res) => res.body.duplicate)).toHaveLength(4);
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_parallel' })).toBe(1);
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('dedupes on the body when there is no event id header', async () => {
    const body = JSON.stringify(subscriptionEvent('subscription.activated', { status: 'active' }));
    const send = () =>
      request(app)
        .post('/api/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sign(body))
        .send(body);
    await send();
    const second = await send();
    expect(second.body.duplicate).toBe(true);
  });

  it('acknowledges events it does not act on', async () => {
    const res = await postWebhook({ event: 'payment.captured', payload: {} });
    expect(res.status).toBe(200);
    expect(await planOf(aliceId)).toBe('free');
  });

  it('forgets an event that failed, so the retry can succeed', async () => {
    const spy = vi.spyOn(Subscription, 'findOne').mockRejectedValueOnce(new Error('db down'));
    const event = subscriptionEvent('subscription.activated', { status: 'active' });

    const failed = await postWebhook(event, { eventId: 'evt_retry' });
    expect(failed.status).toBe(500);
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_retry' })).toBe(0);

    spy.mockRestore();
    const retried = await postWebhook(event, { eventId: 'evt_retry' });
    expect(retried.status).toBe(200);
    expect(await planOf(aliceId)).toBe('pro');
  });

  describe('delivered out of order', () => {
    const at = (createdAt: number, event: string, entity: Record<string, unknown>) => ({
      ...subscriptionEvent(event, entity),
      created_at: createdAt,
    });
    const stored = () => Subscription.findOne({ razorpaySubscriptionId: 'sub_1' });

    it('an older failed payment does not undo a newer charge', async () => {
      await postWebhook(at(2000, 'subscription.charged', { status: 'active' }));
      await postWebhook(at(1000, 'subscription.pending', { status: 'pending' }));
      expect((await stored())?.status).toBe('active');
      expect(await planOf(aliceId)).toBe('pro');
    });

    it('an older renewal does not move the period end back', async () => {
      await postWebhook(
        at(2000, 'subscription.charged', { status: 'active', current_end: 1_950_000_000 }),
      );
      await postWebhook(
        at(1000, 'subscription.charged', { status: 'active', current_end: 1_900_000_000 }),
      );
      expect((await stored())?.currentPeriodEnd?.getTime()).toBe(1_950_000_000_000);
    });

    it('a newer failed payment still applies', async () => {
      await postWebhook(at(1000, 'subscription.charged', { status: 'active' }));
      await postWebhook(at(2000, 'subscription.pending', { status: 'pending' }));
      expect((await stored())?.status).toBe('pending');
      expect(await planOf(aliceId)).toBe('free');
    });

    it('events from the same second apply in the order they arrive', async () => {
      await postWebhook(at(1000, 'subscription.halted', { status: 'halted' }));
      await postWebhook(at(1000, 'subscription.charged', { status: 'active' }));
      expect((await stored())?.status).toBe('active');
    });

    it('an event that ends the subscription always applies', async () => {
      await postWebhook(at(2000, 'subscription.charged', { status: 'active' }));
      await postWebhook(at(1000, 'subscription.cancelled', { status: 'cancelled' }));
      expect((await stored())?.status).toBe('cancelled');
      expect(await planOf(aliceId)).toBe('free');
    });
  });
});

describe('webhook for a subscription not yet saved', () => {
  it('finds the owner from the notes it set at creation', async () => {
    await postWebhook(
      subscriptionEvent('subscription.activated', {
        status: 'active',
        plan_id: 'plan_pro',
        notes: { userId: aliceId.toString() },
      }),
    );
    expect(await planOf(aliceId)).toBe('pro');
    expect(await Subscription.countDocuments({ userId: aliceId })).toBe(1);
  });

  it('acknowledges an unknown owner without failing', async () => {
    const res = await postWebhook(
      subscriptionEvent('subscription.activated', { status: 'active', notes: [] }),
    );
    expect(res.status).toBe(200);
    expect(await Subscription.countDocuments()).toBe(0);
  });
});

describe('GET /api/billing/plans', () => {
  it('is public and shows limits', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.items.map((plan: { id: string }) => plan.id)).toEqual(['free', 'pro']);
    expect(res.body.items[1].limits.messagesPerMonth).toBeGreaterThan(
      res.body.items[0].limits.messagesPerMonth,
    );
  });

  it('marks Pro unavailable until Razorpay is configured', async () => {
    env.RAZORPAY_KEY_ID = undefined;
    const res = await request(app).get('/api/billing/plans');
    expect(res.body.items[1].available).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(KEY_SECRET);
  });
});

describe('POST /api/billing/subscribe', () => {
  beforeEach(() => {
    razorpay.createRazorpaySubscription.mockResolvedValue({ id: 'sub_new', status: 'created' });
    razorpay.fetchRazorpaySubscription.mockResolvedValue({ id: 'sub_new', status: 'created' });
  });

  it('requires auth', async () => {
    expect((await request(app).post('/api/billing/subscribe')).status).toBe(401);
  });

  it('creates a subscription and returns what Checkout needs, without the secret', async () => {
    const res = await request(app).post('/api/billing/subscribe').set(alice);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscriptionId: 'sub_new', keyId: 'rzp_test_key' });
    expect(razorpay.createRazorpaySubscription).toHaveBeenCalledWith(
      'plan_pro',
      aliceId.toString(),
    );
    const stored = await Subscription.findOne({ razorpaySubscriptionId: 'sub_new' });
    expect(stored?.status).toBe('created');
    // Paying has not happened yet.
    expect(await planOf(aliceId)).toBe('free');
  });

  it('reuses an unfinished checkout', async () => {
    await request(app).post('/api/billing/subscribe').set(alice);
    const second = await request(app).post('/api/billing/subscribe').set(alice);
    expect(second.body.subscriptionId).toBe('sub_new');
    expect(razorpay.createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });

  it('does not reopen Checkout for a payment this server missed', async () => {
    await request(app).post('/api/billing/subscribe').set(alice);
    razorpay.fetchRazorpaySubscription.mockResolvedValue({ id: 'sub_new', status: 'active' });

    const second = await request(app).post('/api/billing/subscribe').set(alice);

    expect(second.status).toBe(409);
    expect(await planOf(aliceId)).toBe('pro');
    expect(razorpay.createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });

  it('starts over when the earlier checkout can no longer be paid', async () => {
    await request(app).post('/api/billing/subscribe').set(alice);
    razorpay.fetchRazorpaySubscription.mockResolvedValue({ id: 'sub_new', status: 'expired' });
    razorpay.createRazorpaySubscription.mockResolvedValue({ id: 'sub_next', status: 'created' });

    const second = await request(app).post('/api/billing/subscribe').set(alice);

    expect(second.body.subscriptionId).toBe('sub_next');
  });

  it.each(['pending', 'halted', 'paused'] as const)(
    'cancels a %s subscription before starting another, so it cannot charge twice',
    async (status) => {
      await Subscription.create({
        userId: aliceId,
        razorpaySubscriptionId: 'sub_old',
        planId: 'plan_pro',
        status,
      });
      razorpay.cancelRazorpaySubscription.mockResolvedValue({ id: 'sub_old', status: 'cancelled' });

      const res = await request(app).post('/api/billing/subscribe').set(alice);

      expect(res.body.subscriptionId).toBe('sub_new');
      expect(razorpay.cancelRazorpaySubscription).toHaveBeenCalledWith('sub_old', false);
      const old = await Subscription.findOne({ razorpaySubscriptionId: 'sub_old' });
      expect(old?.status).toBe('cancelled');
    },
  );

  it('starts nothing when the earlier subscription cannot be cancelled', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_old',
      planId: 'plan_pro',
      status: 'pending',
    });
    razorpay.cancelRazorpaySubscription.mockRejectedValue(
      new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Razorpay could not complete this request.'),
    );

    const res = await request(app).post('/api/billing/subscribe').set(alice);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(razorpay.createRazorpaySubscription).not.toHaveBeenCalled();
  });

  it('does not cancel twice a subscription already set to end', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_old',
      planId: 'plan_pro',
      status: 'pending',
      cancelAtCycleEnd: true,
    });

    const res = await request(app).post('/api/billing/subscribe').set(alice);

    expect(res.body.subscriptionId).toBe('sub_new');
    expect(razorpay.cancelRazorpaySubscription).not.toHaveBeenCalled();
  });

  it('saves nothing when Razorpay refuses to create the subscription', async () => {
    razorpay.createRazorpaySubscription.mockRejectedValue(
      new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Razorpay could not complete this request.'),
    );

    const res = await request(app).post('/api/billing/subscribe').set(alice);

    expect(res.status).toBe(502);
    expect(await Subscription.countDocuments({ userId: aliceId })).toBe(0);
  });

  it('refuses when already subscribed', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_active',
      planId: 'plan_pro',
      status: 'active',
    });
    const res = await request(app).post('/api/billing/subscribe').set(alice);
    expect(res.status).toBe(409);
  });

  it('explains when payments are not set up', async () => {
    env.RAZORPAY_PRO_PLAN_ID = undefined;
    const res = await request(app).post('/api/billing/subscribe').set(alice);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BILLING_NOT_CONFIGURED');
  });
});

describe('POST /api/billing/verify', () => {
  const signed = (paymentId: string, subscriptionId: string) => ({
    razorpay_payment_id: paymentId,
    razorpay_subscription_id: subscriptionId,
    razorpay_signature: createHmac('sha256', KEY_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex'),
  });

  beforeEach(async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_1',
      planId: 'plan_pro',
    });
    razorpay.fetchRazorpaySubscription.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_end: 1_900_000_000,
    });
  });

  it('upgrades after a valid payment, using Razorpay’s own record', async () => {
    const res = await request(app)
      .post('/api/billing/verify')
      .set(alice)
      .send(signed('pay_1', 'sub_1'));
    expect(res.status).toBe(200);
    expect(razorpay.fetchRazorpaySubscription).toHaveBeenCalledWith('sub_1');
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('rejects a forged signature', async () => {
    const res = await request(app)
      .post('/api/billing/verify')
      .set(alice)
      .send({ ...signed('pay_1', 'sub_1'), razorpay_signature: 'forged' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await planOf(aliceId)).toBe('free');
  });

  it('does not upgrade when Razorpay says the subscription is not active', async () => {
    razorpay.fetchRazorpaySubscription.mockResolvedValue({ id: 'sub_1', status: 'pending' });
    await request(app).post('/api/billing/verify').set(alice).send(signed('pay_1', 'sub_1'));
    expect(await planOf(aliceId)).toBe('free');
  });

  it('reads again while Razorpay is still settling the first charge', async () => {
    razorpay.fetchRazorpaySubscription
      .mockResolvedValueOnce({ id: 'sub_1', status: 'created' })
      .mockResolvedValueOnce({ id: 'sub_1', status: 'active' });

    await request(app).post('/api/billing/verify').set(alice).send(signed('pay_1', 'sub_1'));

    expect(razorpay.fetchRazorpaySubscription).toHaveBeenCalledTimes(2);
    expect(await planOf(aliceId)).toBe('pro');
  });

  it('stops reading after a few tries, and does not claim Pro', async () => {
    razorpay.fetchRazorpaySubscription.mockResolvedValue({ id: 'sub_1', status: 'created' });

    const res = await request(app)
      .post('/api/billing/verify')
      .set(alice)
      .send(signed('pay_1', 'sub_1'));

    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('created');
    expect(razorpay.fetchRazorpaySubscription).toHaveBeenCalledTimes(3);
    expect(await planOf(aliceId)).toBe('free');
  });

  it('refuses someone else’s subscription', async () => {
    await createUser('mallory');
    const res = await request(app)
      .post('/api/billing/verify')
      .set(authHeader('mallory'))
      .send(signed('pay_1', 'sub_1'));
    expect(res.status).toBe(404);
    expect(await planOf(aliceId)).toBe('free');
  });
});

describe('POST /api/billing/cancel', () => {
  it('returns 404 with nothing to cancel', async () => {
    const res = await request(app).post('/api/billing/cancel').set(alice);
    expect(res.status).toBe(404);
  });

  it('cancels at the end of the period and keeps Pro until then', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_1',
      planId: 'plan_pro',
      status: 'active',
    });
    await User.updateOne({ _id: aliceId }, { plan: 'pro' });
    razorpay.cancelRazorpaySubscription.mockResolvedValue({ id: 'sub_1', status: 'active' });

    const res = await request(app).post('/api/billing/cancel').set(alice);

    expect(res.status).toBe(200);
    expect(razorpay.cancelRazorpaySubscription).toHaveBeenCalledWith('sub_1', true);
    expect(res.body.subscription.cancelAtCycleEnd).toBe(true);
    expect(await planOf(aliceId)).toBe('pro');
  });
});

describe('GET /api/me with a subscription', () => {
  it('shows the current subscription and hides an unfinished checkout', async () => {
    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_draft',
      planId: 'plan_pro',
      status: 'created',
    });
    const before = await request(app).get('/api/me').set(alice);
    expect(before.body.subscription).toBeNull();

    await Subscription.create({
      userId: aliceId,
      razorpaySubscriptionId: 'sub_live',
      planId: 'plan_pro',
      status: 'active',
    });
    const after = await request(app).get('/api/me').set(alice);
    expect(after.body.subscription.razorpaySubscriptionId).toBe('sub_live');
  });
});
