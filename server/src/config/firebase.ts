import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import { serviceUnavailable } from '../utils/errors.js';
import { env } from './env.js';

function getFirebaseAuth() {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    throw serviceUnavailable(
      'AUTH_NOT_CONFIGURED',
      'Firebase Admin is not configured on the server. See the README setup steps.',
    );
  }
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
    });
  }
  return getAuth();
}

export function verifyFirebaseToken(idToken: string): Promise<DecodedIdToken> {
  return getFirebaseAuth().verifyIdToken(idToken);
}
