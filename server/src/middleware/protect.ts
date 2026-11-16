import type { NextFunction, Request, Response } from 'express';
import { verifyFirebaseToken } from '../config/firebase.js';
import type { UserDoc } from '../models/User.js';
import { User } from '../models/User.js';
import { AppError, unauthorized } from '../utils/errors.js';

function bearerToken(req: Request): string {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw unauthorized('Missing bearer token');
  }
  return token;
}

/** Verifies the Firebase ID token only. Used by /auth/sync, before a Mongo user exists. */
export async function verifyToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  try {
    req.firebaseToken = await verifyFirebaseToken(token);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'auth/id-token-expired') {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Session expired. Sign in again.');
    }
    throw unauthorized('Invalid authentication token');
  }
  next();
}

/** Verifies the token and loads the Mongo user. Every signed-in route goes through this. */
export async function protect(req: Request, res: Response, next: NextFunction): Promise<void> {
  await verifyToken(req, res, () => undefined);

  const user = await User.findOne({ firebaseUid: req.firebaseToken?.uid });
  if (!user) {
    throw new AppError(401, 'USER_NOT_SYNCED', 'Call POST /api/auth/sync after signing in');
  }
  req.user = user;
  next();
}

/** Returns the authenticated user, for handlers that run after `protect`. */
export function currentUser(req: Request): UserDoc {
  if (!req.user) throw unauthorized();
  return req.user;
}
