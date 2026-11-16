import type { DecodedIdToken } from 'firebase-admin/auth';
import { User } from '../../src/models/index.js';

/** Tokens the mocked verifier accepts have the form `test:<uid>`. */
export async function fakeVerifyFirebaseToken(idToken: string): Promise<DecodedIdToken> {
  if (idToken === 'expired') {
    throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' });
  }
  if (!idToken.startsWith('test:')) {
    throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' });
  }
  const uid = idToken.slice('test:'.length);
  return {
    uid,
    email: `${uid}@example.com`,
    name: `Name ${uid}`,
    picture: `https://example.com/${uid}.png`,
  } as unknown as DecodedIdToken;
}

export function authHeader(uid: string): { Authorization: string } {
  return { Authorization: `Bearer test:${uid}` };
}

export function createUser(uid: string, plan: 'free' | 'pro' = 'free') {
  return User.create({ firebaseUid: uid, email: `${uid}@example.com`, plan });
}
