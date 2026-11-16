import type { DecodedIdToken } from 'firebase-admin/auth';
import type { UserDoc } from '../models/User.js';
import type { MeteredField } from '../services/billing/usage.js';

declare global {
  namespace Express {
    interface Request {
      firebaseToken?: DecodedIdToken;
      user?: UserDoc;
      usageReservation?: { field: MeteredField; period: string };
    }
  }
}
