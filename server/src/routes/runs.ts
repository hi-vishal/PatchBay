import { Router } from 'express';
import * as runs from '../controllers/runs.js';
import { protect } from '../middleware/protect.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { idParams } from '../utils/validation.js';

export const runsRouter = Router();
runsRouter.use(protect);
runsRouter.get('/', validate({ query: runs.listRunsQuery }), runs.listRuns);
runsRouter.get('/:id', validate({ params: idParams }), runs.getRun);
runsRouter.post(
  '/:id/resume',
  aiLimiter,
  validate({ params: idParams, body: runs.resumeRunSchema }),
  runs.resumeRun,
);
