import { Router } from 'express';
import { getMe, syncSchema, syncUser } from '../controllers/auth.js';
import { protect, verifyToken } from '../middleware/protect.js';
import { validate } from '../middleware/validate.js';

export const authRouter = Router();
authRouter.post('/sync', verifyToken, validate({ body: syncSchema }), syncUser);

export const meRouter = Router();
meRouter.get('/', protect, getMe);
