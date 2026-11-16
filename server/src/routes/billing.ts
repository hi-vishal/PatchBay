import { Router } from 'express';
import {
  cancel,
  getPlans,
  redeem,
  redeemSchema,
  subscribe,
  verifyCheckout,
  verifySchema,
} from '../controllers/billing.js';
import { protect } from '../middleware/protect.js';
import { redeemLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const billingRouter = Router();
// Public, so the landing page can show real plans and limits.
billingRouter.get('/plans', getPlans);
billingRouter.post('/subscribe', protect, subscribe);
billingRouter.post('/verify', protect, validate({ body: verifySchema }), verifyCheckout);
billingRouter.post('/cancel', protect, cancel);
billingRouter.post('/redeem', redeemLimiter, protect, validate({ body: redeemSchema }), redeem);
