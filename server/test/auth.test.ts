import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/index.js';
import { authHeader, createUser } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

vi.mock('../src/config/firebase.js', async () => {
  const { fakeVerifyFirebaseToken } = await import('./helpers/auth.js');
  return { verifyFirebaseToken: fakeVerifyFirebaseToken };
});

useTestDatabase();
const app = createApp();

describe('protect', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a non-bearer scheme', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('reports an expired token with its own code', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer expired');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a valid token with no Mongo user', async () => {
    const res = await request(app).get('/api/me').set(authHeader('ghost'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('USER_NOT_SYNCED');
  });

  it('loads the Mongo user for a valid token', async () => {
    const user = await createUser('alice');
    const res = await request(app).get('/api/me').set(authHeader('alice'));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user._id.toString());
  });
});

describe('POST /api/auth/sync', () => {
  it('requires a token', async () => {
    const res = await request(app).post('/api/auth/sync').send({});
    expect(res.status).toBe(401);
  });

  it('creates the user from token claims', async () => {
    const res = await request(app).post('/api/auth/sync').set(authHeader('bob')).send({});
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      firebaseUid: 'bob',
      email: 'bob@example.com',
      name: 'Name bob',
      plan: 'free',
    });
  });

  it('is idempotent and keeps the plan', async () => {
    await createUser('carol', 'pro');
    await request(app).post('/api/auth/sync').set(authHeader('carol')).send({});
    const res = await request(app).post('/api/auth/sync').set(authHeader('carol')).send({});
    expect(res.body.user.plan).toBe('pro');
    expect(await User.countDocuments({ firebaseUid: 'carol' })).toBe(1);
  });

  it('cannot change identity or plan through the body', async () => {
    const res = await request(app)
      .post('/api/auth/sync')
      .set(authHeader('dave'))
      .send({ firebaseUid: 'victim', plan: 'pro', email: 'victim@example.com', name: 'Dave' });
    expect(res.body.user).toMatchObject({
      firebaseUid: 'dave',
      plan: 'free',
      email: 'dave@example.com',
      name: 'Dave',
    });
  });
});
