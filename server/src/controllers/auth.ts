import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/protect.js';
import { User } from '../models/User.js';
import { PLAN_LIMITS, effectivePlan } from '../services/billing/plans.js';
import { findCurrentSubscription } from '../services/billing/subscriptions.js';
import { getUsageSummary } from '../services/billing/usage.js';
import { unauthorized } from '../utils/errors.js';

export const syncSchema = z.object({
  // Email sign-up sets the display name after the token is issued, so the client may send it.
  name: z.string().trim().min(1).max(100).optional(),
});

/** Creates or refreshes the Mongo user. Identity comes from the verified token, never the body. */
export async function syncUser(req: Request, res: Response): Promise<void> {
  const token = req.firebaseToken;
  if (!token) throw unauthorized();
  const { name } = req.body as z.infer<typeof syncSchema>;

  const user = await User.findOneAndUpdate(
    { firebaseUid: token.uid },
    {
      $set: {
        email: token.email ?? '',
        name: name ?? (token.name as string | undefined) ?? '',
        photoURL: token.picture ?? '',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  res.json({ user });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const [usage, subscription] = await Promise.all([
    getUsageSummary(user._id),
    findCurrentSubscription(user._id),
  ]);
  res.json({ user, usage, limits: PLAN_LIMITS[effectivePlan(user)], subscription });
}
