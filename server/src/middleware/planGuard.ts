import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { PLAN_LIMITS, effectivePlan } from '../services/billing/plans.js';
import type { CountedResource, MeteredField } from '../services/billing/usage.js';
import {
  countResource,
  planLimitError,
  refundUsage,
  reserveUsage,
} from '../services/billing/usage.js';
import { errorMessage } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { currentUser } from './protect.js';

/** Returns a reserved unit. Safe to call more than once, and it never throws. */
export async function refundReservation(req: Request): Promise<void> {
  const reservation = req.usageReservation;
  if (!reservation) return;
  req.usageReservation = undefined;
  await refundUsage(currentUser(req)._id, reservation.period, reservation.field).catch(
    (error: unknown) => {
      logger.warn({ error: errorMessage(error) }, 'Could not refund usage');
    },
  );
}

/**
 * Takes one unit of the month's allowance before the handler runs, and returns 402 when none are
 * left. A request that ends in an error status gets its unit back.
 */
export function requireUsage(field: MeteredField): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = currentUser(req);
    const period = await reserveUsage(user._id, effectivePlan(user), field);
    req.usageReservation = { field, period };
    res.once('finish', () => {
      if (res.statusCode >= 400) void refundReservation(req);
    });
    next();
  };
}

/** Returns 402 when creating one more of this resource would pass the plan's limit. */
export function requireCapacity(resource: CountedResource): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const user = currentUser(req);
    const plan = effectivePlan(user);
    const limit = PLAN_LIMITS[plan][resource];
    if (Number.isFinite(limit) && (await countResource(user._id, resource)) >= limit) {
      throw planLimitError(resource, plan, limit);
    }
    next();
  };
}
