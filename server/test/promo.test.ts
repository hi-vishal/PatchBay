import type { Types } from 'mongoose';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { PromoCode, UsageCounter, User } from '../src/models/index.js';
import { PLAN_LIMITS } from '../src/services/billing/plans.js';
import {
  createPromoCodes,
  generateCode,
  hashCode,
  normalizeCode,
  revokePromoCode,
} from '../src/services/billing/promoCodes.js';
import { syncSubscription } from '../src/services/billing/subscriptions.js';
import { currentPeriod, reserveUsage } from '../src/services/billing/usage.js';
import { authHeader, createUser } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

useTestDatabase();

const app = createApp();
const alice = authHeader('alice');
const bob = authHeader('bob');
let aliceId: Types.ObjectId;

const redeem = (code: string, auth = alice) =>
  request(app).post('/api/billing/redeem').set(auth).send({ code });

beforeEach(async () => {
  aliceId = (await createUser('alice'))._id;
  await createUser('bob');
});

describe('promo code format', () => {
  it('makes long, unambiguous codes', () => {
    const code = generateCode();
    expect(code).toMatch(/^PB(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect(new Set(Array.from({ length: 200 }, generateCode)).size).toBe(200);
  });

  it('accepts the code however it was typed', () => {
    expect(normalizeCode(' pb-abcd0-1o2il ')).toBe('PBABCD010211');
    expect(hashCode('PB-ABCDE-FGH0J-KMN1P')).toBe(hashCode('pb abcde fghoj kmnlp'));
  });

  it('stores only a hash and a short hint', async () => {
    const [code] = await createPromoCodes({ label: 'Owner' });
    const stored = await PromoCode.findOne().select('+codeHash').lean();
    expect(stored?.codeHash).toBe(hashCode(code!));
    expect(stored?.hint).toBe(code!.slice(-4));
    expect(JSON.stringify(stored)).not.toContain(code!);
  });
});

describe('POST /api/billing/redeem', () => {
  it('gives unlimited use, shown on /api/me', async () => {
    const [code] = await createPromoCodes();
    const res = await redeem(code!.toLowerCase());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plan: 'unlimited' });

    const me = await request(app).get('/api/me').set(alice);
    expect(me.body.user.plan).toBe('unlimited');
    expect(me.body.user.promoCodeId).toBeUndefined();
    expect(me.body.limits).toEqual({
      messagesPerMonth: null,
      runsPerMonth: null,
      agents: null,
      mcpServers: null,
      workflows: null,
    });
  });

  it('rejects unknown, expired, revoked and used-up codes with one message', async () => {
    const [single] = await createPromoCodes();
    const [expired] = await createPromoCodes({ expiresAt: new Date(Date.now() - 1000) });
    const [revoked] = await createPromoCodes();
    const toRevoke = await PromoCode.findOne({ codeHash: hashCode(revoked!) });
    await revokePromoCode(toRevoke!._id.toString());
    expect((await redeem(single!, bob)).status).toBe(200);

    for (const code of ['PB-NOPE0-NOPE0-NOPE0', expired!, revoked!, single!]) {
      const res = await redeem(code);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PROMO_CODE');
    }
    expect((await User.findById(aliceId))?.promoCodeId).toBeUndefined();
  });

  it('cannot spend a one-use code twice in parallel', async () => {
    const [code] = await createPromoCodes();
    const users = await Promise.all(['c1', 'c2', 'c3', 'c4'].map((uid) => createUser(uid)));
    const results = await Promise.all(users.map((u) => redeem(code!, authHeader(u.firebaseUid))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await PromoCode.findOne())?.redeemedBy).toHaveLength(1);
  });

  it('lets a multi-use code serve several people, once each', async () => {
    const [code] = await createPromoCodes({ maxRedemptions: 2 });
    expect((await redeem(code!)).status).toBe(200);
    expect((await redeem(code!)).status).toBe(409);
    expect((await redeem(code!, bob)).status).toBe(200);
  });

  it('validates the body and needs sign-in', async () => {
    expect((await request(app).post('/api/billing/redeem').send({ code: 'x' })).status).toBe(401);
    expect((await redeem('')).status).toBe(400);
    expect((await redeem('x'.repeat(65))).status).toBe(400);
  });
});

describe('unlimited use', () => {
  beforeEach(async () => {
    const [code] = await createPromoCodes();
    await redeem(code!);
  });

  it('has no monthly cap but still counts', async () => {
    await UsageCounter.create({
      userId: aliceId,
      period: currentPeriod(),
      messages: PLAN_LIMITS.pro.messagesPerMonth + 5,
    });
    await expect(reserveUsage(aliceId, 'unlimited', 'messages')).resolves.toBe(currentPeriod());
    expect((await UsageCounter.findOne({ userId: aliceId }))?.messages).toBe(
      PLAN_LIMITS.pro.messagesPerMonth + 6,
    );
  });

  it('ignores the free limit on resources', async () => {
    for (let i = 0; i <= PLAN_LIMITS.free.workflows; i += 1) {
      const res = await request(app)
        .post('/api/workflows')
        .set(alice)
        .send({ name: `W${i}`, nodes: [], edges: [] });
      expect(res.status).toBe(201);
    }
  });

  it('survives billing events and blocks a paid checkout', async () => {
    await syncSubscription({
      id: 'sub_x',
      status: 'cancelled',
      notes: { userId: aliceId.toString() },
    } as Parameters<typeof syncSubscription>[0]);
    expect((await request(app).get('/api/me').set(alice)).body.user.plan).toBe('unlimited');
    expect((await request(app).post('/api/billing/subscribe').set(alice)).status).toBe(409);
  });

  it('ends when the code is revoked', async () => {
    const promo = await PromoCode.findOne();
    expect(await revokePromoCode(promo!._id.toString())).toEqual({ found: true, users: 1 });
    expect((await request(app).get('/api/me').set(alice)).body.user.plan).toBe('free');
  });
});
