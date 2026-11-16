import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const rateLimited = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and retry shortly.' },
};

const skip = () => env.NODE_ENV === 'test';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: rateLimited,
  skip,
});

/** Tighter limit for routes that spend LLM tokens or start runs. */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: rateLimited,
  skip,
});

/** For promo codes. Codes are long and random, but guessing should still be slow. */
export const redeemLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: rateLimited,
  skip,
});
