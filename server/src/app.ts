import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { razorpayWebhook } from './controllers/billing.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { sanitizeRequest } from './middleware/sanitize.js';
import { apiRouter } from './routes/index.js';
import { CONVERSATION_HEADER } from './services/graphs/turn.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export function createApp(): express.Express {
  const app = express();

  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    compression({
      // A compressed stream is held back until a block fills, which would stall chat tokens.
      filter: (req, res) =>
        !String(res.getHeader('Content-Type') ?? '').includes('text/event-stream') &&
        compression.filter(req, res),
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Requests with no Origin header (curl, webhooks, same-origin) are not CORS requests.
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, 'CORS_NOT_ALLOWED', 'Origin is not allowed'));
      },
      credentials: false,
      exposedHeaders: [CONVERSATION_HEADER],
    }),
  );
  app.use(
    pinoHttp({
      logger,
      // Log the route only: query strings and headers can carry tokens.
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // Before the JSON parser, because the signature covers the raw bytes. Before the rate limiter,
  // because a dropped webhook means a customer's plan goes out of date.
  app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhook);

  app.use('/api', apiLimiter);
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeRequest);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
