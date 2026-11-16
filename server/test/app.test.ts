import type { Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/error.js';
import { sanitizeRequest, stripMongoOperators } from '../src/middleware/sanitize.js';
import { validate } from '../src/middleware/validate.js';
import { AppError } from '../src/utils/errors.js';

describe('app', () => {
  const app = createApp();

  it('reports degraded health when the database is down', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', database: 'down' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects origins outside the allowlist', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.test');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_NOT_ALLOWED');
  });

  it('allows origins on the allowlist', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://allowed.test');
    expect(res.headers['access-control-allow-origin']).toBe('http://allowed.test');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('stripMongoOperators', () => {
  it('removes operator and dotted keys at any depth', () => {
    expect(
      stripMongoOperators({
        a: 1,
        $gt: 2,
        'b.c': 3,
        nested: { $ne: 1, ok: [{ $where: 'x', y: 2 }] },
      }),
    ).toEqual({ a: 1, nested: { ok: [{ y: 2 }] } });
  });
});

describe('request middleware', () => {
  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use(sanitizeRequest);
    app.post(
      '/echo',
      validate({ query: z.object({ limit: z.coerce.number().default(5) }) }),
      (req: Request, res: Response) => {
        res.json({ body: req.body, query: req.query });
      },
    );
    app.get('/boom', () => {
      throw new AppError(418, 'TEAPOT', 'short and stout');
    });
    app.get('/crash', () => {
      throw new Error('database password is hunter2');
    });
    app.use(errorHandler);
    return app;
  };

  it('strips operators from the body and query', async () => {
    const res = await request(buildApp())
      .post('/echo?limit=2&$where=1')
      .send({ email: { $ne: null }, name: 'a' });
    expect(res.body.body).toEqual({ email: {}, name: 'a' });
    expect(res.body.query).toEqual({ limit: 2 });
  });

  it('returns validation errors as 400', async () => {
    const res = await request(buildApp()).post('/echo?limit=abc').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('formats AppError with its status and code', async () => {
    const res = await request(buildApp()).get('/boom');
    expect(res.status).toBe(418);
    expect(res.body.error).toMatchObject({ code: 'TEAPOT', message: 'short and stout' });
  });

  it('never leaks internal error messages', async () => {
    const res = await request(buildApp()).get('/crash');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
